import { AIService } from './aiService';
import { PRDService } from './prdService';
import { TaskRepository } from '../repositories/taskRepository';
import { PRDDocument, GenerateStoriesRequest, GenerateStoriesResponse, UserStory, AcceptanceCriterion } from '@devflow-studio/shared';
import { createFile, ensureDirectory } from '../utils/fileSystem';
import * as path from 'path';

export class UserStoryGeneratorService {
  private aiService: AIService;
  private prdService: PRDService;
  private taskRepo: TaskRepository;

  constructor() {
    this.aiService = new AIService();
    this.prdService = new PRDService();
    this.taskRepo = new TaskRepository();
  }

  /**
   * Generate user stories automatically from PRD
   */
  async generateStoriesFromPRD(request: GenerateStoriesRequest): Promise<GenerateStoriesResponse> {
    // Get PRD document
    const prd = await this.prdService.getPRDById(request.prd_id);
    if (!prd) {
      throw new Error('PRD document not found');
    }

    // Log PRD details for debugging - FORCE RELOAD CHECK
    console.log(`[UserStoryGenerator v2] PRD Status: ${prd.status}, Vision length: ${prd.vision?.length || 0}, Personas count: ${prd.personas?.length || 0}`);

    // Ensure PRD is validated - auto-validate if in draft status
    if (prd.status === 'draft') {
      console.log(`[UserStoryGenerator v2] Auto-validating PRD ${request.prd_id} before generating stories`);
      
      // First, validate the PRD content to get specific error messages
      const validation = await this.prdService.validatePRD(prd);
      if (!validation.valid) {
        const errorDetails = validation.errors.join('; ');
        console.error(`[UserStoryGenerator v2] PRD validation failed with errors: ${errorDetails}`);
        throw new Error(`PRD validation failed: ${errorDetails}`);
      }
      
      // If validation passes, mark as validated
      try {
        const validatedPRD = await this.prdService.validatePRDDocument(request.prd_id);
        if (!validatedPRD || (validatedPRD.status !== 'validated' && validatedPRD.status !== 'approved')) {
          throw new Error('PRD validation completed but status was not updated correctly');
        }
        
        // Update the prd variable to use the validated version
        const updatedPrd = await this.prdService.getPRDById(request.prd_id);
        if (updatedPrd) {
          Object.assign(prd, updatedPrd);
        }
        console.log(`[UserStoryGenerator v2] PRD ${request.prd_id} validated successfully`);
      } catch (error: any) {
        // This catch is only for validatePRDDocument errors, validation errors are thrown above
        console.error('[UserStoryGenerator v2] Error marking PRD as validated:', error.message);
        throw error;
      }
    } else if (prd.status !== 'validated' && prd.status !== 'approved') {
      throw new Error(`PRD must be validated before generating user stories. Current status: ${prd.status}`);
    }

    // Build prompt for AI to generate stories
    const prompt = this.buildStoryGenerationPrompt(prd, request.options);

    // Create AI job with skipBundle to use only the prompt (lightweight mode)
    const aiJob = await this.aiService.createAIJob({
      project_id: request.project_id,
      provider: 'cursor',
      mode: 'agent',
      prompt,
    } as any, {
      prd_id: request.prd_id,
      phase: 'story_generation',
      skipBundle: true, // Use lightweight mode, only the prompt
    });

    // Return job ID so frontend can poll for completion
    // The worker will process the response and save stories automatically
    return {
      stories: [],
      summary: {
        total_generated: 0,
        by_persona: {},
      },
      job_id: aiJob.id,
    } as GenerateStoriesResponse;
  }

  /**
   * Build prompt for generating user stories from PRD
   */
  private buildStoryGenerationPrompt(prd: PRDDocument, options?: GenerateStoriesRequest['options']): string {
    const lines: string[] = [];

    lines.push('# Generate User Stories from PRD');
    lines.push('');
    lines.push('## PRD Vision');
    lines.push(prd.vision);
    lines.push('');

    lines.push('## User Personas');
    prd.personas.forEach((persona, index) => {
      lines.push(`### Persona ${index + 1}: ${persona.role}`);
      if (persona.name) {
        lines.push(`**Name**: ${persona.name}`);
      }
      lines.push('');
      lines.push('**Needs:**');
      persona.needs.forEach(need => {
        lines.push(`- ${need}`);
      });
      lines.push('');
      lines.push('**Goals:**');
      persona.goals.forEach(goal => {
        lines.push(`- ${goal}`);
      });
      if (persona.pain_points && persona.pain_points.length > 0) {
        lines.push('');
        lines.push('**Pain Points:**');
        persona.pain_points.forEach(pp => {
          lines.push(`- ${pp}`);
        });
      }
      lines.push('');
    });

    lines.push('---');
    lines.push('');
    lines.push('## Instructions');
    lines.push('');
    lines.push('Generate comprehensive user stories based on the PRD above. For each persona, create user stories that address their needs and goals.');
    lines.push('');
    lines.push('### Format Requirements');
    lines.push('');
    lines.push('Each user story MUST follow this format:');
    lines.push('**"Yo como [usuario], quiero [acción], para [beneficio]"**');
    lines.push('');
    lines.push('### Acceptance Criteria Requirements');
    lines.push('');
    lines.push('Each user story MUST include both functional and technical acceptance criteria:');
    lines.push('- **Functional AC**: Describe what the feature should do from a user perspective');
    lines.push('- **Technical AC**: Describe technical requirements, constraints, or implementation details');
    lines.push('');
    lines.push('### Output Format');
    lines.push('');
    lines.push('Return a JSON array of user stories in the following format:');
    lines.push('```json');
    lines.push('[');
    lines.push('  {');
    lines.push('    "title": "Yo como [usuario], quiero [acción], para [beneficio]",');
    lines.push('    "description": "Detailed description of the story",');
    lines.push('    "user_role": "[extracted role]",');
    lines.push('    "action": "[extracted action]",');
    lines.push('    "benefit": "[extracted benefit]",');
    lines.push('    "acceptance_criteria": [');
    lines.push('      {');
    lines.push('        "criterion": "Functional criterion description",');
    lines.push('        "type": "functional",');
    lines.push('        "priority": "high"');
    lines.push('      },');
    lines.push('      {');
    lines.push('        "criterion": "Technical criterion description",');
    lines.push('        "type": "technical",');
    lines.push('        "priority": "medium"');
    lines.push('      }');
    lines.push('    ]');
    lines.push('  }');
    lines.push(']');
    lines.push('```');
    lines.push('');
    lines.push('### Important Guidelines');
    lines.push('');
    lines.push('1. Generate stories for ALL personas and ALL their needs');
    lines.push('2. Each story must be independent and testable');
    lines.push('3. Acceptance criteria must be specific and measurable');
    lines.push('4. Include both positive and negative test cases in AC when applicable');
    lines.push('5. Technical AC should cover API contracts, data validation, error handling, etc.');
    lines.push('6. Do NOT generate stories that exceed the scope defined in the PRD vision');
    lines.push('');
    lines.push('### CRITICAL: Output Format');
    lines.push('');
    lines.push('**YOU MUST RETURN ONLY THE JSON ARRAY. NO EXPLANATIONS, NO INTRODUCTORY TEXT, NO COMMENTS.**');
    lines.push('');
    lines.push('Your response must start with [ and end with ]. Do NOT include:');
    lines.push('- Introductory sentences like "I\'ve generated..." or "Here are the stories..."');
    lines.push('- Explanations before or after the JSON');
    lines.push('- Markdown formatting around the JSON');
    lines.push('- Any text whatsoever outside the JSON array');
    lines.push('');
    lines.push('**IMPORTANT: Return ONLY the raw JSON array, nothing else. The response should start with [ and end with ].**');

    return lines.join('\n');
  }

  /**
   * Parse user stories from AI response
   */
  async parseStoriesFromAIResponse(aiResponse: string): Promise<UserStory[]> {
    // Try to extract JSON array from response
    let jsonString = '';
    
    // Pattern 1: Code block with json
    const codeBlockMatch = aiResponse.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
    if (codeBlockMatch) {
      jsonString = codeBlockMatch[1];
    } else {
      // Pattern 2: Direct JSON array
      const arrayMatch = aiResponse.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        jsonString = arrayMatch[0];
      }
    }

    if (!jsonString) {
      throw new Error('No JSON array found in AI response');
    }

    try {
      const storiesData = JSON.parse(jsonString);
      if (!Array.isArray(storiesData)) {
        throw new Error('Parsed data is not an array');
      }

      return storiesData.map((story: any) => this.mapToUserStory(story));
    } catch (error: any) {
      throw new Error(`Failed to parse stories from AI response: ${error.message}`);
    }
  }

  /**
   * Map raw story data to UserStory type
   */
  private mapToUserStory(data: any): UserStory {
    return {
      id: '', // Will be set when saved
      project_id: '', // Will be set when saved
      title: data.title || '',
      description: data.description || data.title,
      user_role: data.user_role || this.extractRole(data.title),
      action: data.action || this.extractAction(data.title),
      benefit: data.benefit || this.extractBenefit(data.title),
      acceptance_criteria: (data.acceptance_criteria || []).map((ac: any) => ({
        criterion: ac.criterion || ac,
        type: ac.type === 'functional' || ac.type === 'technical' ? ac.type : 'functional',
        priority: ac.priority || 'medium',
      })),
      generated_from_prd: true,
      status: 'todo',
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  /**
   * Extract user role from story title
   */
  private extractRole(title: string): string {
    const match = title.match(/Yo como\s+([^,]+)/i);
    return match ? match[1].trim() : 'usuario';
  }

  /**
   * Extract action from story title
   */
  private extractAction(title: string): string {
    const match = title.match(/quiero\s+([^,]+)/i);
    return match ? match[1].trim() : '';
  }

  /**
   * Extract benefit from story title
   */
  private extractBenefit(title: string): string {
    const match = title.match(/para\s+(.+)/i);
    return match ? match[1].trim() : '';
  }

  /**
   * Save stories to filesystem
   */
  async saveStoriesToFilesystem(projectBasePath: string, projectId: string, stories: UserStory[]): Promise<void> {
    const storiesDir = path.join(projectBasePath, 'docs', 'user-stories', projectId);
    await ensureDirectory(storiesDir);

    // Save as JSON
    const jsonPath = path.join(storiesDir, 'stories.json');
    await createFile(jsonPath, JSON.stringify(stories, null, 2));

    // Save as Markdown
    const mdPath = path.join(storiesDir, 'stories.md');
    const mdContent = this.generateStoriesMarkdown(stories);
    await createFile(mdPath, mdContent);
  }

  /**
   * Generate Markdown from stories
   */
  private generateStoriesMarkdown(stories: UserStory[]): string {
    const lines: string[] = [];
    lines.push('# User Stories');
    lines.push('');
    lines.push(`**Total Stories**: ${stories.length}`);
    lines.push(`**Generated**: ${new Date().toISOString()}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    stories.forEach((story, index) => {
      lines.push(`## Story ${index + 1}: ${story.title}`);
      lines.push('');
      if (story.description && story.description !== story.title) {
        lines.push(story.description);
        lines.push('');
      }
      lines.push('### Details');
      lines.push(`- **User Role**: ${story.user_role}`);
      lines.push(`- **Action**: ${story.action}`);
      lines.push(`- **Benefit**: ${story.benefit}`);
      if (story.story_points) {
        lines.push(`- **Story Points**: ${story.story_points}`);
      }
      lines.push('');
      lines.push('### Acceptance Criteria');
      lines.push('');
      story.acceptance_criteria.forEach((ac, acIndex) => {
        lines.push(`${acIndex + 1}. **[${ac.type.toUpperCase()}]** (${ac.priority}) ${ac.criterion}`);
      });
      lines.push('');
      lines.push('---');
      lines.push('');
    });

    return lines.join('\n');
  }
}
