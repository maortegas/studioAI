import { ProjectRepository } from '../repositories/projectRepository';
import { CreateProjectRequest, Project } from '@devflow-studio/shared';
import { ensureDirectory, createFile, validatePath } from '../utils/fileSystem';
import path from 'path';

export class ProjectService {
  private projectRepo: ProjectRepository;

  constructor() {
    this.projectRepo = new ProjectRepository();
  }

  async getAllProjects(): Promise<Project[]> {
    return await this.projectRepo.findAll();
  }

  async getProjectById(id: string): Promise<Project | null> {
    return await this.projectRepo.findById(id);
  }

  async createProject(data: CreateProjectRequest): Promise<Project> {
    // Validate base_path - only check for path traversal, allow any absolute path
    const normalizedPath = path.normalize(data.base_path);
    if (normalizedPath.includes('..') || !path.isAbsolute(data.base_path)) {
      throw new Error('Invalid base path: must be an absolute path without path traversal');
    }

    // Create project directory
    await ensureDirectory(data.base_path);

    // Create initial files
    const prdPath = path.join(data.base_path, 'artifacts', 'PRD.md');
    const contextPackPath = path.join(data.base_path, 'CONTEXT_PACK.md');
    const cursorRulesPath = path.join(data.base_path, '.cursor', 'rules', 'devflow.md');
    const claudePath = path.join(data.base_path, 'CLAUDE.md');

    // PRD template
    const prdTemplate = `# Product Requirements Document (PRD)

## Problem Statement
<!-- Describe the problem this project aims to solve -->

## Target Users
<!-- Who are the primary users of this product? -->

## Objectives
<!-- What are the main goals of this project? -->

## Constraints
<!-- What are the technical, business, or resource constraints? -->

## Non-Objectives
<!-- What is explicitly out of scope? -->

## Success Metrics
<!-- How will we measure success? -->
`;

    // Context Pack template
    const contextPackTemplate = `# Context Pack

This file contains the context and information needed for AI-assisted development.

## Project Overview
- **Name**: ${data.name}
- **Tech Stack**: ${data.tech_stack || 'Not specified'}

## Project Structure
<!-- Document the project structure and key files -->

## Development Guidelines
<!-- Add any specific development guidelines or conventions -->
`;

    // Cursor rules template
    const cursorRulesTemplate = `# DevFlow Studio Rules

This project is managed by DevFlow Studio.

## Project Context
- **Name**: ${data.name}
- **Tech Stack**: ${data.tech_stack || 'Not specified'}

## Coding Standards
<!-- Add coding standards and conventions -->
`;

    // Claude template
    const claudeTemplate = `# Claude Context

This file provides context for Claude AI assistance.

## Project Information
- **Name**: ${data.name}
- **Tech Stack**: ${data.tech_stack || 'Not specified'}

## Development Context
<!-- Add development context and guidelines -->
`;

    await createFile(prdPath, prdTemplate);
    await createFile(contextPackPath, contextPackTemplate);
    await createFile(cursorRulesPath, cursorRulesTemplate);
    await createFile(claudePath, claudeTemplate);

    // Create project in database
    return await this.projectRepo.create(data);
  }

  async updateProject(id: string, data: Partial<CreateProjectRequest>): Promise<Project | null> {
    return await this.projectRepo.update(id, data);
  }

  async deleteProject(id: string): Promise<boolean> {
    return await this.projectRepo.delete(id);
  }
}

