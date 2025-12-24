import { AIService } from './aiService';
import { PRDService } from './prdService';
import { TaskRepository } from '../repositories/taskRepository';
import { PRDDocument, GenerateStoriesRequest, GenerateStoriesResponse, UserStory, AcceptanceCriterion, Feature } from '@devflow-studio/shared';
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

    // --- 1. CONTEXTO Y VISION ---
    lines.push(`# User Story Generation Task`);
    lines.push(`## Role`);
    lines.push(`You are an expert Product Owner and Business Analyst.`);
    lines.push(``);
    
    lines.push(`## PRD Vision`);
    lines.push(prd.vision || 'No vision provided.');
    lines.push(``);

    // --- 2. PERSONAS (Mantenido igual) ---
    lines.push(`## User Personas`);
    if (prd.personas && prd.personas.length > 0) {
      prd.personas.forEach((persona, index) => {
        lines.push(`### Persona ${index + 1}: ${persona.role}`);
        lines.push(`- **Needs:** ${persona.needs.join(', ')}`);
        lines.push(`- **Goals:** ${persona.goals.join(', ')}`);
        if (persona.pain_points?.length) {
          lines.push(`- **Pain Points:** ${persona.pain_points.join(', ')}`);
        }
        lines.push(``);
      });
    }

    // --- 3. ALCANCE DEFINIDO (LA CLAVE ANTI-ALUCINACIÓN) ---
    // Aquí restringimos el universo del LLM. Solo puede usar esto.
    lines.push(`---`);
    lines.push(`## DEFINED SCOPE (Source of Truth)`);
    lines.push(`Below are the ONLY approved features and requirements for this project.`);
    lines.push(`**STRICT RULE:** You must generate user stories EXCLUSIVELY based on the items listed below.`);
    lines.push(`Do NOT invent new features, flows, or requirements that are not explicitly described here.`);
    lines.push(``);
    
    if (prd.features && prd.features.length > 0) {
      prd.features.forEach((feature: Feature, index: number) => {
        lines.push(`### Feature ${index + 1}: ${feature.title}`);
        if (feature.id) lines.push(`**ID:** ${feature.id}`);
        lines.push(`${feature.description}`);
        lines.push(``);
      });
    } else {
      lines.push(`**WARNING:** No specific features were provided in the PRD. Rely strictly on the Vision and Personas, but keep stories high-level and conceptual.`);
      lines.push(``);
    }

    // --- 4. INSTRUCCIONES ESTRICTAS ---
    lines.push(`## Instructions`);
    lines.push(`1. Map the User Personas' Needs to the Defined Scope features.`);
    lines.push(`2. Create user stories ONLY if a Defined Feature supports a Persona's Need.`);
    lines.push(`3. If a Persona has a Need that is NOT covered by the Defined Scope, DO NOT create a story for it. Do not try to "fill the gap" with hallucinated features.`);
    lines.push(`4. Each story MUST reference the specific Feature ID (or Title) it implements.`);
    lines.push(``);

    // --- 5. FORMATO JSON CON TRAZABILIDAD ---
    lines.push(`## Output Format`);
    lines.push(`Return a RAW JSON array (no markdown).`);
    lines.push(`Each object must strictly follow this schema:`);
    lines.push(`\`\`\`json`);
    lines.push(`[`);
    lines.push(`  {`);
    lines.push(`    "title": "Yo como [rol], quiero [acción], para [beneficio]",`);
    lines.push(`    "user_role": "[rol]",`);
    lines.push(`    "related_feature": "[Title or ID of the feature from Defined Scope]",`);
    lines.push(`    "description": "[Explanation of how this story implements the specific feature]",`);
    lines.push(`    "acceptance_criteria": [`);
    lines.push(`      { "criterion": "...", "type": "functional" },`);
    lines.push(`      { "criterion": "...", "type": "technical" }`);
    lines.push(`    ]`);
    lines.push(`  }`);
    lines.push(`]`);
    lines.push(`\`\`\``);
    
    // --- 6. BLOQUEO FINAL ---
    lines.push(``);
    lines.push(`## CRITICAL SAFETY CHECK`);
    lines.push(`Before outputting, verify: Does every story correspond to a Feature listed in "DEFINED SCOPE"?`);
    lines.push(`If yes, output JSON. If no, remove the hallucinated story.`);

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
      related_feature: data.related_feature || undefined, // Feature ID or Title from PRD
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
