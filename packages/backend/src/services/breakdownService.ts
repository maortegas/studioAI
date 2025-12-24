import { EpicRepository } from '../repositories/epicRepository';
import { TaskRepository } from '../repositories/taskRepository';
import { RFCGeneratorService } from './rfcGeneratorService';
import { AIService } from './aiService';
import { ProjectRepository } from '../repositories/projectRepository';
import { BreakdownRequest, BreakdownResponse, Epic } from '@devflow-studio/shared';
import { createFile, ensureDirectory } from '../utils/fileSystem';
import * as path from 'path';
import pool from '../config/database';

export class BreakdownService {
  private epicRepo: EpicRepository;
  private taskRepo: TaskRepository;
  private rfcService: RFCGeneratorService;
  private aiService: AIService;
  private projectRepo: ProjectRepository;

  constructor() {
    this.epicRepo = new EpicRepository();
    this.taskRepo = new TaskRepository();
    this.rfcService = new RFCGeneratorService();
    this.aiService = new AIService();
    this.projectRepo = new ProjectRepository();
  }

  /**
   * Generate breakdown: Épicas and Tasks from RFC
   */
  async generateBreakdown(request: BreakdownRequest): Promise<{ job_id: string }> {
    // Get RFC
    const rfc = await this.rfcService.getRFCById(request.rfc_id);
    if (!rfc) {
      throw new Error('RFC not found');
    }

    // Get project
    const project = await this.projectRepo.findById(request.project_id);
    if (!project) {
      throw new Error('Project not found');
    }

    // Get User Stories
    const allStories = await this.taskRepo.findByProjectIdAndType(request.project_id, 'story');
    
    // Filter by epic_ids if provided
    let relevantStories = allStories;
    if (request.epic_ids && request.epic_ids.length > 0) {
      // Get stories for specified epics
      const storiesResult = await pool.query(
        'SELECT id FROM tasks WHERE epic_id = ANY($1::uuid[])',
        [request.epic_ids]
      );
      const storyIds = storiesResult.rows.map((r: any) => r.id);
      relevantStories = allStories.filter(s => storyIds.includes(s.id));
    }
    
    // Sort stories by priority (higher priority first) to ensure proper ordering in breakdown
    relevantStories.sort((a, b) => {
      const priorityA = a.priority || 0;
      const priorityB = b.priority || 0;
      return priorityB - priorityA; // Descending order (higher priority first)
    });

    // Build prompt for breakdown (now async)
    const prompt = await this.buildBreakdownPrompt(rfc, relevantStories, project, request.options);

    // Create AI job
    const aiJob = await this.aiService.createAIJob({
      project_id: request.project_id,
      provider: 'cursor',
      mode: 'agent',
      prompt,
    } as any, {
      rfc_id: request.rfc_id,
      phase: 'breakdown_generation',
      max_days_per_task: request.options?.max_days_per_task || 3,
      estimate_story_points: request.options?.estimate_story_points ?? true,
      skipBundle: true,
    });

    return {
      job_id: aiJob.id,
    };
  }

  /**
   * Build prompt for breakdown generation
   */
  private async buildBreakdownPrompt(
    rfc: any,
    stories: any[],
    project: any,
    options?: BreakdownRequest['options']
  ): Promise<string> {
    const lines: string[] = [];
    const maxDays = options?.max_days_per_task || 3;

    // Get full context using buildPromptBundle (includes PRD, Architecture, RFC, Stories, Design)
    const promptBundle = await this.aiService.buildPromptBundle(project.id);
    
    lines.push('# Generate Breakdown: Épicas and Granular Tasks from User Stories + RFC');
    lines.push('');
    lines.push('The context below includes:');
    lines.push('- **PRD**: Product Requirements Document with vision and personas');
    lines.push('- **Architecture**: System architecture documentation');
    lines.push('- **RFC**: Complete Technical Design (API contracts, database schema, architecture decisions)');
    lines.push('- **User Stories**: All user stories with acceptance criteria');
    lines.push('- **Design**: User flows and design specifications');
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(promptBundle);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## User Stories');
    lines.push('');
    if (stories.length > 0) {
      stories.forEach((story, index) => {
        lines.push(`### ${index + 1}. ${story.title}`);
        if (story.priority !== undefined && story.priority !== null) {
          lines.push(`**Priority**: ${story.priority}`);
        }
        if (story.acceptance_criteria && Array.isArray(story.acceptance_criteria) && story.acceptance_criteria.length > 0) {
          lines.push('**Acceptance Criteria**:');
          story.acceptance_criteria.forEach((criteria: any) => {
            const criterionText = typeof criteria === 'string' ? criteria : criteria.criterion || criteria;
            lines.push(`- ${criterionText}`);
          });
        }
        lines.push('');
      });
    } else {
      lines.push('*No user stories available - generate tasks based on RFC only*');
      lines.push('');
    }

    lines.push('### RFC Summary');
    lines.push(`**Title**: ${rfc.title}`);
    lines.push(`**Status**: ${rfc.status}`);
    if (rfc.architecture_type) {
      lines.push(`**Architecture Type**: ${rfc.architecture_type}`);
    }
    lines.push('');

    lines.push('---');
    lines.push('');
    lines.push('## Strategy');
    lines.push('');
    lines.push('Break down User Stories and RFC into Épicas (Epics) and granular Tasks:');
    lines.push('');
    lines.push('1. **User Stories are the primary source** - Each story should become an Epic OR be converted into tasks directly');
    lines.push('2. **RFC provides technical context** - Use it for implementation details, API contracts, database schema, and architecture patterns');
    lines.push('3. **Priority ordering** - Order épicas and tasks by User Story priority (higher priority = lower order_index)');
    lines.push('4. **Task granularity** - Each task must be specific, actionable, and directly fulfill User Story acceptance criteria');
    lines.push('5. **Technical dependencies** - Identify blocking relationships (e.g., DB models before API endpoints)');
    lines.push('');

    lines.push('---');
    lines.push('');
    lines.push('## Instructions');
    lines.push('');
    lines.push('### Épicas (Epics)');
    lines.push('');
    lines.push('Create épicas primarily from User Stories. Each épica should:');
    lines.push('- Represent one or more related User Stories (grouped by functionality)');
    lines.push('- Have a title derived from the User Story title or logical grouping');
    lines.push('- Include description from User Story description');
    lines.push('- Be ordered by User Story priority (higher priority = lower order_index)');
    lines.push('- Have story points estimated from User Story complexity');
    lines.push('');
    lines.push('### Tasks (Granular)');
    lines.push('');
    lines.push('For each épica, create **GRANULAR, ACTIONABLE** tasks that:');
    lines.push(`- **MUST NOT exceed ${maxDays} days of development each**`);
    lines.push(`- **MUST be specific and implementable** (e.g., 'Create User model with fields: id, email, name' not 'Implement user management')`);
    lines.push('- **MUST directly fulfill User Story acceptance criteria** (each task should satisfy at least one criterion)');
    lines.push('- **MUST use RFC technical specifications** to understand HOW to implement (API endpoints, database tables, services)');
    lines.push('- **MUST identify dependencies** - List task titles that must be completed before this task can start');
    lines.push('- Include clear acceptance criteria derived from User Story acceptance criteria');
    lines.push('- Include technical details from RFC (e.g., "Create POST /api/users endpoint as specified in RFC")');
    lines.push('');
    lines.push('### Dependency Tracking');
    lines.push('');
    lines.push('For each task, identify blocking dependencies:');
    lines.push('- **Database tasks** (e.g., "Create User model") must be completed before **API tasks** (e.g., "Create POST /api/users")');
    lines.push('- **Service tasks** must be completed before **API endpoint tasks**');
    lines.push('- **Backend tasks** must be completed before **Frontend tasks** that consume them');
    lines.push('- List the **titles** of blocking tasks in the `dependencies` array');
    lines.push('- Example: If "Create POST /api/users" depends on "Create User model", then dependencies: ["Create User model"]');
    lines.push('');

    lines.push('### Estimation Logic');
    lines.push('');
    lines.push('**estimated_days**:');
    lines.push(`- Can be decimals (0.5, 1.5, 2.5) for partial day estimates`);
    lines.push(`- **MUST NOT exceed ${maxDays} days**`);
    lines.push(`- If a task would take longer, break it down into smaller tasks`);
    lines.push('');
    lines.push('**story_points**:');
    lines.push('- Follow Fibonacci sequence: 1, 2, 3, 5, 8, 13');
    lines.push('- Based on User Story complexity and task scope');
    lines.push('- Use lower values (1-3) for simple tasks, higher values (5-13) for complex tasks');
    lines.push('');

    lines.push('### Breakdown Rules');
    lines.push('');
    lines.push('1. **Priority ordering**: Order épicas and tasks by User Story priority (highest first)');
    lines.push('2. **Granularity**: If a task would exceed ' + maxDays + ' days, break it down into smaller tasks');
    lines.push('3. **User Story mapping**: Each task MUST map to at least one acceptance criterion from User Stories');
    lines.push('4. **RFC technical details**: Use exact API endpoint names, database table/column names, and architecture patterns from RFC');
    lines.push('5. **Dependency identification**: Clearly identify and list all blocking dependencies for each task');
    lines.push('');

    lines.push('### Output Format');
    lines.push('');
    lines.push('Return a JSON object with the following structure:');
    lines.push('```json');
    lines.push('{');
    lines.push('  "epics": [');
    lines.push('    {');
    lines.push('      "title": "Epic title",');
    lines.push('      "description": "Epic description",');
    lines.push('      "story_points": 13,');
    lines.push('      "order_index": 1');
    lines.push('    }');
    lines.push('  ],');
    lines.push('  "tasks": [');
    lines.push('    {');
    lines.push('      "title": "Task title",');
    lines.push('      "description": "Task description",');
    lines.push('      "epic_title": "Epic title (must match one from epics array)",');
    lines.push('      "estimated_days": 1.5,');
    lines.push('      "story_points": 3,');
    lines.push('      "breakdown_order": 1,');
    lines.push('      "dependencies": ["Blocking task title 1", "Blocking task title 2"],');
    lines.push('      "acceptance_criteria": [');
    lines.push('        {');
    lines.push('          "criterion": "Criterion description",');
    lines.push('          "type": "functional",');
    lines.push('          "priority": "high"');
    lines.push('        }');
    lines.push('      ]');
    lines.push('    }');
    lines.push('  ]');
    lines.push('}');
    lines.push('```');
    lines.push('');
    lines.push('**CRITICAL INSTRUCTIONS:**');
    lines.push('1. **Dependencies**: For each task, identify blocking tasks and list their **titles** in the `dependencies` array');
    lines.push('2. **Estimation**: Use decimal values for `estimated_days` if needed, but never exceed ' + maxDays + ' days');
    lines.push('3. **Story Points**: Use Fibonacci sequence (1, 2, 3, 5, 8, 13) for `story_points`');
    lines.push('4. **Priority ordering**: Order épicas by User Story priority (highest priority = lower order_index)');
    lines.push('5. **Task grouping**: Tasks must be grouped under épicas by epic_title');
    lines.push('6. **Output format**: Start your response directly with the JSON object. Do not include any text before or after.');

    return lines.join('\n');
  }

  /**
   * Parse breakdown from AI response
   */
  async parseBreakdownFromAIResponse(aiResponse: string): Promise<{
    epics: Array<{ title: string; description: string; story_points?: number; order_index?: number }>;
    tasks: Array<{
      title: string;
      description: string;
      epic_title: string;
      estimated_days: number;
      story_points?: number;
      breakdown_order: number;
      dependencies?: string[];
      acceptance_criteria: any[];
    }>;
  }> {
    // Try to extract JSON object from response
    let jsonString = '';
    
    // Pattern 1: Code block with json
    const codeBlockMatch = aiResponse.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeBlockMatch) {
      jsonString = codeBlockMatch[1];
    } else {
      // Pattern 2: Direct JSON object
      const objectMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        jsonString = objectMatch[0];
      }
    }

    if (!jsonString) {
      throw new Error('No JSON object found in AI response');
    }

    try {
      const breakdownData = JSON.parse(jsonString);
      if (!breakdownData.epics || !Array.isArray(breakdownData.epics)) {
        throw new Error('Invalid breakdown: epics array missing');
      }
      if (!breakdownData.tasks || !Array.isArray(breakdownData.tasks)) {
        throw new Error('Invalid breakdown: tasks array missing');
      }

      // Validate tasks don't exceed max days
      const maxDays = 3;
      const invalidTasks = breakdownData.tasks.filter((t: any) => 
        t.estimated_days && t.estimated_days > maxDays
      );
      if (invalidTasks.length > 0) {
        throw new Error(
          `Tasks exceed maximum days (${maxDays}): ${invalidTasks.map((t: any) => t.title).join(', ')}`
        );
      }

      return breakdownData;
    } catch (error: any) {
      throw new Error(`Failed to parse breakdown from AI response: ${error.message}`);
    }
  }

  /**
   * Get epics by project
   */
  async getEpicsByProject(projectId: string): Promise<Epic[]> {
    return await this.epicRepo.findByProjectId(projectId);
  }

  /**
   * Get epics by RFC
   */
  async getEpicsByRFC(rfcId: string): Promise<Epic[]> {
    return await this.epicRepo.findByRFCId(rfcId);
  }
}
