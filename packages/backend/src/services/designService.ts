import { UserFlowRepository } from '../repositories/userFlowRepository';
import { PrototypeRepository } from '../repositories/prototypeRepository';
import { PRDRepository } from '../repositories/prdRepository';
import { TaskRepository } from '../repositories/taskRepository';
import { StoryUserFlowRepository } from '../repositories/storyUserFlowRepository';
import { AIService } from './aiService';
import { GenerateUserFlowRequest, AnalyzePrototypeRequest, UserFlow, Prototype } from '@devflow-studio/shared';
import { createFile, ensureDirectory } from '../utils/fileSystem';
import * as path from 'path';
import * as fs from 'fs/promises';
import pool from '../config/database';

export class DesignService {
  private userFlowRepo: UserFlowRepository;
  private prototypeRepo: PrototypeRepository;
  private prdRepo: PRDRepository;
  private taskRepo: TaskRepository;
  private storyUserFlowRepo: StoryUserFlowRepository;
  private aiService: AIService;

  constructor() {
    this.userFlowRepo = new UserFlowRepository();
    this.prototypeRepo = new PrototypeRepository();
    this.prdRepo = new PRDRepository();
    this.taskRepo = new TaskRepository();
    this.storyUserFlowRepo = new StoryUserFlowRepository();
    this.aiService = new AIService();
  }

  /**
   * Generate User Flow from PRD and/or User Stories
   */
  async generateUserFlow(request: GenerateUserFlowRequest): Promise<{ job_id: string; user_flow_id: string }> {
    // Create placeholder user flow in DB
    const userFlow = await this.userFlowRepo.create({
      ...request,
      flow_diagram: undefined, // Will be populated by worker
    });

    // Get context (PRD and/or Stories)
    let prdContent = '';
    let storiesContent = '';

    if (request.prd_id) {
      const prd = await this.prdRepo.findById(request.prd_id);
      if (prd) {
        prdContent = `Vision: ${prd.vision}\n\nPersonas: ${JSON.stringify(prd.personas, null, 2)}`;
      }
    } else {
      // Get PRD by project_id
      const prd = await this.prdRepo.findByProjectId(request.project_id);
      if (prd) {
        prdContent = `Vision: ${prd.vision}\n\nPersonas: ${JSON.stringify(prd.personas, null, 2)}`;
      }
    }

    if (request.story_ids && request.story_ids.length > 0) {
      const stories = await Promise.all(
        request.story_ids.map(id => this.taskRepo.findById(id))
      );
      const validStories = stories.filter(s => s !== null);
      storiesContent = validStories.map(s => 
        `- ${s!.title}: ${s!.description || ''}`
      ).join('\n');
    } else {
      // Get all stories for project
      const allStories = await this.taskRepo.findByProjectIdAndType(request.project_id, 'story');
      storiesContent = allStories.map(s => 
        `- ${s.title}: ${s.description || ''}`
      ).join('\n');
    }

    // Build prompt
    const prompt = this.buildUserFlowPrompt(request.flow_name, request.description, prdContent, storiesContent);

    // Create AI job
    const aiJob = await this.aiService.createAIJob({
      project_id: request.project_id,
      provider: 'cursor',
      mode: 'agent',
      prompt,
    } as any, {
      user_flow_id: userFlow.id,
      phase: 'user_flow_generation',
      skipBundle: true,
      story_ids: request.story_ids || [], // Pass story IDs to worker for linking
    });

    // Create story_user_flows relationships if story_ids provided
    if (request.story_ids && request.story_ids.length > 0) {
      for (const storyId of request.story_ids) {
        try {
          await this.storyUserFlowRepo.create(storyId, userFlow.id);
          console.log(`[DesignService] Linked story ${storyId} to user flow ${userFlow.id}`);
        } catch (error: any) {
          console.error(`[DesignService] Error linking story ${storyId} to user flow ${userFlow.id}:`, error.message);
          // Continue with other stories even if one fails
        }
      }
    } else {
      // If no specific stories provided, link all stories for the project
      const allStories = await this.taskRepo.findByProjectIdAndType(request.project_id, 'story');
      for (const story of allStories) {
        try {
          await this.storyUserFlowRepo.create(story.id, userFlow.id);
          console.log(`[DesignService] Linked story ${story.id} to user flow ${userFlow.id}`);
        } catch (error: any) {
          console.error(`[DesignService] Error linking story ${story.id} to user flow ${userFlow.id}:`, error.message);
          // Continue with other stories even if one fails
        }
      }
    }

    return {
      job_id: aiJob.id,
      user_flow_id: userFlow.id,
    };
  }

  /**
   * Build prompt for user flow generation
   */
  private buildUserFlowPrompt(
    flowName: string,
    description: string | undefined,
    prdContent: string,
    storiesContent: string
  ): string {
    const lines: string[] = [];

    lines.push('# Generate User Flow Diagram');
    lines.push('');
    lines.push(`## Flow Name: ${flowName}`);
    if (description) {
      lines.push(`## Description: ${description}`);
      lines.push('');
    }
    lines.push('');

    if (prdContent) {
      lines.push('## PRD Context');
      lines.push(prdContent);
      lines.push('');
    }

    if (storiesContent) {
      lines.push('## User Stories');
      lines.push(storiesContent);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
    lines.push('## Instructions');
    lines.push('');
    lines.push('Generate a user flow diagram in Mermaid format that represents the user journey.');
    lines.push('');
    lines.push('The diagram should:');
    lines.push('- Show the complete user journey from start to end');
    lines.push('- Include decision points and branches');
    lines.push('- Show user actions and system responses');
    lines.push('- Be clear and easy to understand');
    lines.push('');
    lines.push('### Output Format');
    lines.push('');
    lines.push('Return ONLY a valid Mermaid diagram code block, starting with ```mermaid and ending with ```.');
    lines.push('');
    lines.push('Example:');
    lines.push('```mermaid');
    lines.push('flowchart TD');
    lines.push('    Start[User starts] --> Action1[Action 1]');
    lines.push('    Action1 --> Decision{Decision?}');
    lines.push('    Decision -->|Yes| Action2[Action 2]');
    lines.push('    Decision -->|No| End[End]');
    lines.push('    Action2 --> End');
    lines.push('```');
    lines.push('');
    lines.push('**IMPORTANT**: Return ONLY the Mermaid code block, nothing else.');

    return lines.join('\n');
  }

  /**
   * Analyze prototype image
   */
  async analyzePrototype(request: AnalyzePrototypeRequest): Promise<{ job_id: string; prototype_id: string }> {
    // Verify file exists (file_path is relative to uploads directory)
    const absoluteFilePath = path.join(process.cwd(), 'uploads', request.file_path);
    const fileExists = await fs.access(absoluteFilePath).then(() => true).catch(() => false);
    if (!fileExists) {
      throw new Error(`Prototype file not found: ${absoluteFilePath}`);
    }

    // Create prototype record
    const prototype = await this.prototypeRepo.create(request);

    // Build prompt for image analysis (use absolute path for AI analysis)
    const absolutePathForAI = path.join(process.cwd(), 'uploads', request.file_path);
    const prompt = this.buildPrototypeAnalysisPrompt(request.file_name, absolutePathForAI);

    // Create AI job with image analysis
    const aiJob = await this.aiService.createAIJob({
      project_id: request.project_id,
      provider: 'cursor',
      mode: 'agent',
      prompt,
    } as any, {
      prototype_id: prototype.id,
      file_path: request.file_path,
      phase: 'prototype_analysis',
      skipBundle: true,
    });

    return {
      job_id: aiJob.id,
      prototype_id: prototype.id,
    };
  }

  /**
   * Build prompt for prototype analysis
   */
  private buildPrototypeAnalysisPrompt(fileName: string, filePath: string): string {
    const lines: string[] = [];

    lines.push('# Analyze Prototype Image');
    lines.push('');
    lines.push(`## File: ${fileName}`);
    lines.push(`## Path: ${filePath}`);
    lines.push('');
    lines.push('Analyze the provided prototype/screenshot image and extract:');
    lines.push('');
    lines.push('1. **UI Elements**: Identify buttons, forms, inputs, navigation, headers, etc.');
    lines.push('2. **User Flows**: Understand the navigation and interaction paths');
    lines.push('3. **Insights**: Note design patterns, usability considerations, and recommendations');
    lines.push('');
    lines.push('### Output Format');
    lines.push('');
    lines.push('Return a JSON object with the following structure:');
    lines.push('```json');
    lines.push('{');
    lines.push('  "elements": [');
    lines.push('    {');
    lines.push('      "type": "button|form|input|navigation|header|etc",');
    lines.push('      "position": { "x": 100, "y": 200 },');
    lines.push('      "label": "Element label or text"');
    lines.push('    }');
    lines.push('  ],');
    lines.push('  "flows": [');
    lines.push('    {');
    lines.push('      "from": "Starting point description",');
    lines.push('      "to": "Destination description",');
    lines.push('      "description": "Flow description"');
    lines.push('    }');
    lines.push('  ],');
    lines.push('  "insights": [');
    lines.push('    "Insight 1",');
    lines.push('    "Insight 2"');
    lines.push('  ]');
    lines.push('}');
    lines.push('```');
    lines.push('');
    lines.push('**IMPORTANT**: Return ONLY the JSON object, nothing else. Start with { and end with }.');

    return lines.join('\n');
  }

  /**
   * Get user flows by project
   */
  async getUserFlowsByProject(projectId: string): Promise<UserFlow[]> {
    return await this.userFlowRepo.findByProjectId(projectId);
  }

  /**
   * Get prototypes by project
   */
  async getPrototypesByProject(projectId: string): Promise<Prototype[]> {
    return await this.prototypeRepo.findByProjectId(projectId);
  }

  /**
   * Get user flow by ID
   */
  async getUserFlowById(id: string): Promise<UserFlow | null> {
    return await this.userFlowRepo.findById(id);
  }

  /**
   * Get prototype by ID
   */
  async getPrototypeById(id: string): Promise<Prototype | null> {
    return await this.prototypeRepo.findById(id);
  }
}
