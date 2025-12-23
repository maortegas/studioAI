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
    lines.push('## CRITICAL: PRIORITY ORDER - User Stories FIRST, then RFC');
    lines.push('');
    lines.push('**IMPORTANT**: User Stories are the PRIMARY source for breakdown. RFC provides technical context.');
    lines.push('');
    lines.push('The context below includes:');
    lines.push('- **PRD**: Product Requirements Document with vision and personas');
    lines.push('- **Architecture**: System architecture documentation');
    lines.push('- **RFC**: Complete Technical Design (API contracts, database schema, architecture decisions)');
    lines.push('- **User Stories**: All user stories with acceptance criteria (PRIMARY PRIORITY)');
    lines.push('- **Design**: User flows and design specifications');
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(promptBundle);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## Focus: User Stories FIRST, then RFC for Technical Details');
    lines.push('');
    lines.push('### User Stories Summary (PRIMARY PRIORITY)');
    lines.push('');
    if (stories.length > 0) {
      lines.push(`**Total Stories**: ${stories.length}`);
      lines.push('');
      lines.push('**CRITICAL INSTRUCTION**: These User Stories are your PRIMARY source. Each story should:');
      lines.push('1. Become an Epic OR be directly converted into tasks');
      lines.push('2. Be prioritized based on their priority value (higher priority = earlier in breakdown_order)');
      lines.push('3. Drive the breakdown structure - RFC provides technical implementation details');
      lines.push('');
      stories.forEach((story, index) => {
        lines.push(`#### Story ${index + 1}: ${story.title}`);
        if (story.description) {
          lines.push(`**Description**: ${story.description}`);
        }
        if (story.priority !== undefined && story.priority !== null) {
          lines.push(`**Priority**: ${story.priority} (higher = more important)`);
        }
        if (story.story_points) {
          lines.push(`**Story Points**: ${story.story_points}`);
        }
        if (story.acceptance_criteria && Array.isArray(story.acceptance_criteria) && story.acceptance_criteria.length > 0) {
          lines.push(`**Acceptance Criteria**:`);
          story.acceptance_criteria.forEach((criteria: any, idx: number) => {
            const criterionText = typeof criteria === 'string' ? criteria : criteria.criterion || criteria;
            const criterionType = typeof criteria === 'object' && criteria.type ? ` [${criteria.type}]` : '';
            const criterionPriority = typeof criteria === 'object' && criteria.priority ? ` (${criteria.priority})` : '';
            lines.push(`  ${idx + 1}. ${criterionText}${criterionType}${criterionPriority}`);
          });
        }
        lines.push('');
      });
      lines.push('**CRITICAL**: Each User Story should either:');
      lines.push('- Become an Epic (if complex, with multiple sub-tasks)');
      lines.push('- OR be directly converted into one or more granular tasks');
      lines.push('- Tasks should be ordered by story priority (higher priority stories first)');
      lines.push('');
    } else {
      lines.push('*No user stories available - generate tasks based on RFC only*');
      lines.push('');
    }

    lines.push('### RFC Summary (Technical Context)');
    lines.push(`**Title**: ${rfc.title}`);
    lines.push(`**Status**: ${rfc.status}`);
    if (rfc.architecture_type) {
      lines.push(`**Architecture Type**: ${rfc.architecture_type}`);
    }
    lines.push('');
    lines.push('**IMPORTANT**: The complete RFC content is in the context above. Use it to:');
    lines.push('- Provide technical implementation details for User Story tasks');
    lines.push('- Understand API contracts and endpoints needed to fulfill stories');
    lines.push('- Reference database schema and models required');
    lines.push('- Follow architecture patterns and decisions');
    lines.push('- Add technical tasks that support User Story implementation');
    lines.push('');

    lines.push('---');
    lines.push('');
    lines.push('## Instructions');
    lines.push('');
    lines.push('**YOUR TASK**: Break down User Stories (PRIMARY) and RFC (Technical Context) into Épicas (Epics) and GRANULAR Tasks.');
    lines.push('');
    lines.push('### CRITICAL: User Stories FIRST, RFC for Technical Details');
    lines.push('');
    lines.push('**PRIORITY ORDER**:');
    lines.push('1. **User Stories (PRIMARY)**: Each story should become an Epic OR be converted into tasks directly');
    lines.push('   - High priority stories (priority 8-10) should be broken down first');
    lines.push('   - Medium priority stories (priority 5-7) come next');
    lines.push('   - Low priority stories (priority 1-4) come last');
    lines.push('2. **RFC (Technical Context)**: Provides implementation details, API contracts, database schema');
    lines.push('   - Use RFC to add technical tasks that support User Story implementation');
    lines.push('   - Use RFC to understand how to technically implement story requirements');
    lines.push('3. **Combination**: Tasks should fulfill User Story acceptance criteria using RFC technical specifications');
    lines.push('');
    lines.push('### Épicas (Epics) - Derived from User Stories');
    lines.push('');
    lines.push('Create épicas primarily from User Stories. Each épica should:');
    lines.push('- Represent one or more related User Stories (grouped by functionality)');
    lines.push('- Have a title derived from the User Story title or a logical grouping of stories');
    lines.push('- Include description from User Story description');
    lines.push('- Be ordered by User Story priority (higher priority stories = lower order_index)');
    lines.push('- Have story points estimated from User Story story_points or acceptance criteria complexity');
    lines.push('- Align with RFC architecture components for technical implementation details');
    lines.push('');
    lines.push('### Tasks (GRANULAR - Derived from User Stories)');
    lines.push('');
    lines.push('For each épica (which comes from User Stories), create **GRANULAR, ACTIONABLE** tasks that:');
    lines.push(`- **MUST NOT exceed ${maxDays} days of development each**`);
    lines.push(`- **MUST be specific and implementable** (e.g., 'Create User model with fields: id, email, name' not 'Implement user management')`);
    lines.push('- **MUST directly fulfill User Story acceptance criteria** (each task should satisfy at least one criterion from the story)');
    lines.push('- **MUST use RFC technical specifications** to understand HOW to implement (API endpoints, database tables, services)');
    lines.push('- **MUST be ordered by User Story priority first**, then by technical dependencies (database → API → frontend)');
    lines.push('- Can be developed independently (minimal dependencies)');
    lines.push('- Include clear acceptance criteria derived from User Story acceptance criteria');
    lines.push('- Include technical details from RFC (e.g., "Create POST /api/users endpoint as specified in RFC")');
    if (options?.estimate_story_points) {
      lines.push('- Include story points estimation (Fibonacci: 1, 2, 3, 5, 8, 13) based on User Story complexity');
    }
    lines.push('');
    lines.push('### Breakdown Rules (STRICT)');
    lines.push('');
    lines.push('1. **User Story Priority Rule**: Order épicas and tasks by User Story priority (highest first)');
    lines.push('   - Stories with priority 8-10 should have order_index 1-3');
    lines.push('   - Stories with priority 5-7 should have order_index 4-6');
    lines.push('   - Stories with priority 1-4 should have order_index 7+');
    lines.push('2. **Golden Rule**: No task should take more than 2-3 days to complete');
    lines.push('3. **Granularity Rule**: If a task would take longer, break it down into smaller tasks');
    lines.push('   - Example: Instead of "Implement authentication for Story X", create:');
    lines.push('     - "Create User model with email and password fields (Story X: AC1)"');
    lines.push('     - "Create authentication service with login method (Story X: AC2)"');
    lines.push('     - "Create JWT token generation utility (Story X: AC3)"');
    lines.push('     - "Create login API endpoint POST /api/auth/login (Story X: AC4, RFC Section 3.2)"');
    lines.push('4. **User Story First**: Each task MUST map to at least one acceptance criterion from User Stories');
    lines.push('   - Task title should reference the story or acceptance criterion');
    lines.push('   - Task description should explain how it fulfills the story requirement');
    lines.push('5. **RFC Technical Details**: Use RFC to provide technical implementation specifics:');
    lines.push('   - Use exact API endpoint names from RFC');
    lines.push('   - Use exact database table/column names from RFC');
    lines.push('   - Follow architecture patterns from RFC');
    lines.push('   - Reference RFC sections in task descriptions when relevant');
    lines.push('6. **Dependency Order**: Within each story, consider technical dependencies from RFC:');
    lines.push('   - Database schema → Models → Services → API endpoints → Frontend components');
    lines.push('7. **Task Naming**: Use specific, actionable names that reference the User Story:');
    lines.push('   - ✅ GOOD: "Create UserRepository with findByEmail method (Story: User Login, AC: Validate user exists)"');
    lines.push('   - ✅ GOOD: "Implement POST /api/users endpoint (Story: User Registration, RFC: Section 4.1)"');
    lines.push('   - ❌ BAD: "Implement user repository" (no story reference)');
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
    lines.push('      "estimated_days": 2,');
    lines.push('      "story_points": 3,');
    lines.push('      "breakdown_order": 1,');
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
    lines.push('1. **User Story Priority**: Order épicas by User Story priority (highest priority stories = lower order_index)');
    lines.push('2. **User Story to Epic/Task**: Each User Story should become an Epic OR be converted into tasks directly');
    lines.push('3. **Granularity**: Ensure NO task has estimated_days > ' + maxDays + '. Break down larger tasks.');
    lines.push('4. **User Story Coverage**: Each task MUST map to at least one acceptance criterion from User Stories');
    lines.push('   - Reference the story in task title or description');
    lines.push('   - Explain how the task fulfills the story requirement');
    lines.push('5. **RFC Technical Details**: Use RFC to provide HOW to implement (exact API endpoints, DB tables, etc.)');
    lines.push('6. **Task Grouping**: Tasks must be grouped under épicas by epic_title (épicas come from User Stories)');
    lines.push('7. **Ordering**: breakdown_order should reflect:');
    lines.push('   - First: User Story priority (higher priority = lower breakdown_order)');
    lines.push('   - Then: Technical dependencies within each story (database → API → frontend)');
    lines.push('8. **Task Descriptions**: Include:');
    lines.push('   - Which User Story it fulfills and which acceptance criterion');
    lines.push('   - Specific technical details from RFC (e.g., "Create POST /api/users endpoint as per RFC Section 4.1")');
    lines.push('9. **Output Format**: Start your response directly with the JSON object. Do not include any text before or after.');
    lines.push('10. **Complete Response**: Return the complete JSON object, not a reference to creating files.');
    lines.push('');
    lines.push('**REMEMBER**: User Stories are PRIMARY. Generate épicas and tasks FROM User Stories, using RFC for technical implementation details.');

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
