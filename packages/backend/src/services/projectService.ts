import { ProjectRepository } from '../repositories/projectRepository';
import { CreateProjectRequest, Project } from '@devflow-studio/shared';
import { ensureDirectory, createFile, validatePath } from '../utils/fileSystem';
import { ProjectStructureService } from './projectStructureService';
import { DatabaseService } from './databaseService';
import path from 'path';
import fs from 'fs/promises';

export class ProjectService {
  private projectRepo: ProjectRepository;
  private structureService: ProjectStructureService;
  private databaseService: DatabaseService;

  constructor() {
    this.projectRepo = new ProjectRepository();
    this.structureService = new ProjectStructureService();
    this.databaseService = new DatabaseService();
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

    // Create MVC directory structure
    console.log(`[ProjectService] Creating MVC structure for tech stack: ${data.tech_stack}`);
    await this.structureService.createProjectStructure(data.base_path, data.tech_stack);

    // Check if project uses Prisma and generate database infrastructure
    const hasPrisma = await this.checkIfProjectUsesPrisma(data.base_path);
    if (hasPrisma) {
      console.log(`[ProjectService] Prisma detected, generating database infrastructure...`);
      await this.databaseService.generateDatabaseInfrastructure(data.base_path, data.name);
    }

    // Create initial files
    const prdPath = path.join(data.base_path, 'docs', 'PRD.md');
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
    const project = await this.projectRepo.create(data);
    return project;
  }

  async updateProject(id: string, data: Partial<CreateProjectRequest>): Promise<Project | null> {
    return await this.projectRepo.update(id, data);
  }

  async deleteProject(id: string): Promise<boolean> {
    return await this.projectRepo.delete(id);
  }

  /**
   * Verifica si el proyecto usa Prisma
   */
  private async checkIfProjectUsesPrisma(basePath: string): Promise<boolean> {
    const schemaPath = path.join(basePath, 'prisma', 'schema.prisma');
    const packageJsonPath = path.join(basePath, 'package.json');

    try {
      // Verificar schema.prisma
      await fs.access(schemaPath);
      return true;
    } catch {
      // Schema no existe, verificar package.json
      try {
        const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
        const packageJson = JSON.parse(packageJsonContent);
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
        return 'prisma' in deps || '@prisma/client' in deps;
      } catch {
        return false;
      }
    }
  }
}
