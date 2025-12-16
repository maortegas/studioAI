import { AIJobRepository } from '../repositories/aiJobRepository';
import { ExecuteAIJobRequest, AIJob, AIProvider, AIMode } from '@devflow-studio/shared';
import { ProjectRepository } from '../repositories/projectRepository';
import { ArtifactRepository } from '../repositories/artifactRepository';
import { TaskRepository } from '../repositories/taskRepository';
import { readFile } from '../utils/fileSystem';
import path from 'path';

export class AIService {
  private aiJobRepo: AIJobRepository;
  private projectRepo: ProjectRepository;
  private artifactRepo: ArtifactRepository;
  private taskRepo: TaskRepository;

  constructor() {
    this.aiJobRepo = new AIJobRepository();
    this.projectRepo = new ProjectRepository();
    this.artifactRepo = new ArtifactRepository();
    this.taskRepo = new TaskRepository();
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

    // Add Architecture
    const architecture = await this.artifactRepo.findByProjectIdAndType(projectId, 'architecture');
    if (architecture) {
      try {
        const archContent = await readFile(architecture.path);
        bundle.push('## Architecture Documentation\n');
        bundle.push(archContent);
        bundle.push('\n');
      } catch (error) {
        console.warn('Could not read Architecture:', error);
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
      }
      bundle.push('\n');
    }

    return bundle.join('\n');
  }

  async createAIJob(request: ExecuteAIJobRequest): Promise<AIJob> {
    const promptBundle = await this.buildPromptBundle(request.project_id, request.task_id);

    // Get project to get base_path
    const project = await this.projectRepo.findById(request.project_id);
    if (!project) {
      throw new Error('Project not found');
    }

    // Combine prompt bundle with additional prompt if provided
    const finalPrompt = request.prompt 
      ? `${promptBundle}\n\n${request.prompt}`
      : promptBundle;

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

