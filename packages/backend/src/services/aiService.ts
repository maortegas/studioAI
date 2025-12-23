import { AIJobRepository } from '../repositories/aiJobRepository';
import { ExecuteAIJobRequest, AIJob, AIProvider, AIMode } from '@devflow-studio/shared';
import { ProjectRepository } from '../repositories/projectRepository';
import { ArtifactRepository } from '../repositories/artifactRepository';
import { TaskRepository } from '../repositories/taskRepository';
import { RFCRepository } from '../repositories/rfcRepository';
import { EpicRepository } from '../repositories/epicRepository';
import { UserFlowRepository } from '../repositories/userFlowRepository';
import { readFile } from '../utils/fileSystem';
import path from 'path';

export class AIService {
  private aiJobRepo: AIJobRepository;
  private projectRepo: ProjectRepository;
  private artifactRepo: ArtifactRepository;
  private taskRepo: TaskRepository;
  private rfcRepo: RFCRepository;
  private epicRepo: EpicRepository;
  private userFlowRepo: UserFlowRepository;

  constructor() {
    this.aiJobRepo = new AIJobRepository();
    this.projectRepo = new ProjectRepository();
    this.artifactRepo = new ArtifactRepository();
    this.taskRepo = new TaskRepository();
    this.rfcRepo = new RFCRepository();
    this.epicRepo = new EpicRepository();
    this.userFlowRepo = new UserFlowRepository();
  }

  async buildPromptBundle(projectId: string, taskId?: string): Promise<string> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const bundle: string[] = [];

    // Add project basic info first
    bundle.push('# Project Information\n');
    bundle.push(`**Project Name**: ${project.name}\n`);
    if (project.tech_stack) {
      bundle.push(`**Tech Stack**: ${project.tech_stack}\n`);
    }
    bundle.push('\n');

    // Add PRD (Idea del proyecto) - CRITICAL for architecture generation
    const prd = await this.artifactRepo.findByProjectIdAndType(projectId, 'prd');
    if (prd) {
      try {
        const prdContent = await readFile(prd.path);
        bundle.push('# Product Requirements Document (PRD) - Idea del Proyecto\n');
        bundle.push(prdContent);
        bundle.push('\n');
      } catch (error) {
        console.warn('Could not read PRD:', error);
        bundle.push('## Warning: PRD not found\n');
        bundle.push('The Product Requirements Document (PRD) could not be loaded. Architecture generation may be less accurate.\n\n');
      }
    } else {
      bundle.push('## Warning: PRD not found\n');
      bundle.push('No Product Requirements Document (PRD) exists for this project. Please create the PRD first for better architecture generation.\n\n');
    }

    // Add Architecture (if exists - don't fail if it doesn't)
    const architecture = await this.artifactRepo.findByProjectIdAndType(projectId, 'architecture');
    if (architecture) {
      try {
        const archContent = await readFile(architecture.path);
        bundle.push('## Architecture Documentation\n');
        bundle.push(archContent);
        bundle.push('\n');
      } catch (error: any) {
        // File doesn't exist yet - this is normal for first-time generation
        if (error.code !== 'ENOENT') {
          console.warn('Could not read Architecture:', error);
        }
      }
    }

    // Add Task details if provided
    if (taskId) {
      const task = await this.taskRepo.findById(taskId);
      if (task) {
        bundle.push('## Current Task\n');
        bundle.push(`**Title**: ${task.title}\n`);
        if (task.description) {
          bundle.push(`**Description**: ${task.description}\n`);
        }
        bundle.push(`**Type**: ${task.type}\n`);
        bundle.push(`**Priority**: ${task.priority}\n`);
        bundle.push('\n');
      }
    }

    // Add User Stories
    const stories = await this.taskRepo.findByProjectIdAndType(projectId, 'story');
    if (stories.length > 0) {
      bundle.push('## User Stories\n');
      for (const story of stories) {
        bundle.push(`- **${story.title}**: ${story.description || ''}\n`);
        if (story.acceptance_criteria && story.acceptance_criteria.length > 0) {
          bundle.push(`  - Acceptance Criteria: ${story.acceptance_criteria.join(', ')}\n`);
        }
      }
      bundle.push('\n');
    }

    // Add RFC (most recent approved/draft)
    const rfcs = await this.rfcRepo.findByProjectId(projectId);
    if (rfcs.length > 0) {
      // Use the most recent RFC
      const rfc = rfcs[0];
      bundle.push('## RFC (Request for Comments) - Technical Design\n');
      bundle.push(`**Title**: ${rfc.title}\n`);
      bundle.push(`**Status**: ${rfc.status}\n`);
      if (rfc.architecture_type) {
        bundle.push(`**Architecture Type**: ${rfc.architecture_type}\n`);
      }
      bundle.push(`**Content**:\n${rfc.content}\n\n`);
    }

    // Add Epics and Breakdown Tasks
    const epics = await this.epicRepo.findByProjectId(projectId);
    if (epics.length > 0) {
      bundle.push('## Epics & Breakdown\n');
      for (const epic of epics) {
        bundle.push(`### Epic: ${epic.title}\n`);
        if (epic.description) {
          bundle.push(`${epic.description}\n`);
        }
        if (epic.story_points) {
          bundle.push(`**Story Points**: ${epic.story_points}\n`);
        }
        bundle.push(`**Status**: ${epic.status}\n\n`);
        
        // Get tasks for this epic
        const allTasks = await this.taskRepo.findByProjectId(projectId);
        const epicTasks = allTasks.filter(t => (t as any).epic_id === epic.id && t.type === 'task');
        if (epicTasks.length > 0) {
          bundle.push(`**Tasks (${epicTasks.length}):**\n`);
          epicTasks
            .sort((a, b) => ((a as any).breakdown_order || 0) - ((b as any).breakdown_order || 0))
            .forEach(task => {
              bundle.push(`- ${(task as any).breakdown_order || ''}. **${task.title}**`);
              if ((task as any).estimated_days) {
                bundle.push(` (${(task as any).estimated_days} days)`);
              }
              if ((task as any).story_points) {
                bundle.push(` [${(task as any).story_points} SP]`);
              }
              bundle.push('\n');
              if (task.description) {
                bundle.push(`  ${task.description}\n`);
              }
            });
          bundle.push('\n');
        }
      }
      bundle.push('\n');
    }

    // Add Design (User Flows)
    const userFlows = await this.userFlowRepo.findByProjectId(projectId);
    if (userFlows.length > 0) {
      bundle.push('## User Flows & Design\n');
      for (const flow of userFlows) {
        bundle.push(`### ${flow.flow_name}\n`);
        if (flow.description) {
          bundle.push(`${flow.description}\n`);
        }
        if (flow.flow_diagram) {
          bundle.push(`\n**Flow Diagram (Mermaid):**\n\`\`\`mermaid\n${flow.flow_diagram}\n\`\`\`\n`);
        }
        bundle.push('\n');
      }
      bundle.push('\n');
    }

    return bundle.join('\n');
  }

  async createAIJob(request: ExecuteAIJobRequest, additionalArgs?: Record<string, any>): Promise<AIJob> {
    // Get project to get base_path
    const project = await this.projectRepo.findById(request.project_id);
    if (!project) {
      throw new Error('Project not found');
    }

    // Check if we should skip the full bundle (for test generation, etc.)
    const skipBundle = (request as any).skipBundle === true;
    let finalPrompt: string;

    if (skipBundle && request.prompt) {
      // Use only the provided prompt (lightweight mode)
      finalPrompt = request.prompt;
    } else {
      // Build full prompt bundle
      const promptBundle = await this.buildPromptBundle(request.project_id, request.task_id);
      // Combine prompt bundle with additional prompt if provided
      finalPrompt = request.prompt 
        ? `${promptBundle}\n\n${request.prompt}`
        : promptBundle;
    }

    // Determine command based on provider
    let command: string;
    let args: Record<string, any> = {};

    if (request.provider === 'cursor') {
      command = 'cursor';
      args = {
        mode: request.mode,
        prompt: finalPrompt,
        project_id: request.project_id,
        project_path: project.base_path,
        task_id: request.task_id,
      };
    } else if (request.provider === 'claude') {
      command = 'claude';
      args = {
        mode: request.mode,
        prompt: finalPrompt,
        project_id: request.project_id,
        project_path: project.base_path,
        task_id: request.task_id,
      };
    } else {
      throw new Error(`Unsupported provider: ${request.provider}`);
    }

    // Merge additional args if provided
    if (additionalArgs) {
      args = { ...args, ...additionalArgs };
    }

    const job = await this.aiJobRepo.create({
      project_id: request.project_id,
      task_id: request.task_id,
      provider: request.provider,
      command,
      args,
      status: 'pending',
    });

    return job;
  }

  async getJobById(id: string): Promise<AIJob | null> {
    return await this.aiJobRepo.findById(id);
  }

  async getJobsByProject(projectId: string): Promise<AIJob[]> {
    return await this.aiJobRepo.findByProjectId(projectId);
  }
}

