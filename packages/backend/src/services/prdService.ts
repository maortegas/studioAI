import { PRDRepository } from '../repositories/prdRepository';
import { ProjectRepository } from '../repositories/projectRepository';
import { PRDDocument, CreatePRDRequest, UpdatePRDRequest, PRDValidationResult, Persona } from '@devflow-studio/shared';
import { createFile, ensureDirectory } from '../utils/fileSystem';
import * as path from 'path';
import * as fs from 'fs/promises';

export class PRDService {
  private prdRepo: PRDRepository;
  private projectRepo: ProjectRepository;

  constructor() {
    this.prdRepo = new PRDRepository();
    this.projectRepo = new ProjectRepository();
  }

  /**
   * Validate PRD document
   * Validates that vision and personas exist and are properly formatted
   */
  async validatePRD(prd: { vision?: string; personas?: Persona[] }): Promise<PRDValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate Vision
    if (!prd.vision || prd.vision.trim().length === 0) {
      errors.push('Vision is required and cannot be empty');
    } else if (prd.vision.trim().length < 50) {
      warnings.push('Vision seems too short. Consider providing more details.');
    }

    // Validate Personas
    if (!prd.personas || !Array.isArray(prd.personas) || prd.personas.length === 0) {
      errors.push('At least one persona is required');
    } else {
      prd.personas.forEach((persona, index) => {
        if (!persona.role || persona.role.trim().length === 0) {
          errors.push(`Persona ${index + 1}: Role is required`);
        }
        if (!persona.needs || !Array.isArray(persona.needs) || persona.needs.length === 0) {
          errors.push(`Persona ${index + 1}: At least one need is required`);
        }
        if (!persona.goals || !Array.isArray(persona.goals) || persona.goals.length === 0) {
          warnings.push(`Persona ${index + 1}: Consider adding goals for better context`);
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Get PRD for a project
   */
  async getPRDByProject(projectId: string): Promise<PRDDocument | null> {
    return await this.prdRepo.findByProjectId(projectId);
  }

  /**
   * Get PRD by ID
   */
  async getPRDById(id: string): Promise<PRDDocument | null> {
    return await this.prdRepo.findById(id);
  }

  /**
   * Create PRD document
   */
  async createPRD(data: CreatePRDRequest): Promise<PRDDocument> {
    // Validate the PRD before creating
    const validation = await this.validatePRD(data);
    if (!validation.valid) {
      throw new Error(`PRD validation failed: ${validation.errors.join(', ')}`);
    }

    // Get project to determine base path
    const project = await this.projectRepo.findById(data.project_id);
    if (!project) {
      throw new Error('Project not found');
    }

    // Create PRD document
    const prd = await this.prdRepo.create(data);

    // Save to filesystem in /docs/prd/{project-id}/
    await this.savePRDToFilesystem(project.base_path, prd);

    return prd;
  }

  /**
   * Update PRD document
   */
  async updatePRD(id: string, data: UpdatePRDRequest): Promise<PRDDocument> {
    const existingPRD = await this.prdRepo.findById(id);
    if (!existingPRD) {
      throw new Error('PRD document not found');
    }

    // Merge with existing data for validation
    const mergedPRD = {
      vision: data.vision !== undefined ? data.vision : existingPRD.vision,
      personas: data.personas !== undefined ? data.personas : existingPRD.personas,
    };

    // Validate if vision or personas are being updated
    if (data.vision !== undefined || data.personas !== undefined) {
      const validation = await this.validatePRD(mergedPRD);
      if (!validation.valid) {
        throw new Error(`PRD validation failed: ${validation.errors.join(', ')}`);
      }
    }

    // Update PRD
    const updated = await this.prdRepo.update(id, data);
    if (!updated) {
      throw new Error('Failed to update PRD document');
    }

    // Update filesystem
    const project = await this.projectRepo.findById(updated.project_id);
    if (project) {
      await this.savePRDToFilesystem(project.base_path, updated);
    }

    return updated;
  }

  /**
   * Validate PRD (mark as validated)
   * This should be called before allowing progression to next step
   */
  async validatePRDDocument(id: string): Promise<PRDDocument> {
    const prd = await this.prdRepo.findById(id);
    if (!prd) {
      throw new Error('PRD document not found');
    }

    // Validate the PRD
    const validation = await this.validatePRD(prd);
    if (!validation.valid) {
      throw new Error(`PRD validation failed: ${validation.errors.join(', ')}`);
    }

    // Mark as validated
    const updated = await this.prdRepo.update(id, { status: 'validated' });
    if (!updated) {
      throw new Error('Failed to validate PRD document');
    }

    return updated;
  }

  /**
   * Save PRD to filesystem
   */
  private async savePRDToFilesystem(projectBasePath: string, prd: PRDDocument): Promise<void> {
    const prdDir = path.join(projectBasePath, 'docs', 'prd', prd.project_id);
    await ensureDirectory(prdDir);

    // Save vision
    const visionPath = path.join(prdDir, 'vision.md');
    await createFile(visionPath, prd.vision);

    // Save personas as JSON
    const personasPath = path.join(prdDir, 'personas.json');
    await createFile(personasPath, JSON.stringify(prd.personas, null, 2));

    // Save combined PRD document
    const prdPath = path.join(prdDir, 'PRD.md');
    const prdContent = this.generatePRDMarkdown(prd);
    await createFile(prdPath, prdContent);
  }

  /**
   * Generate PRD Markdown from PRD document
   */
  private generatePRDMarkdown(prd: PRDDocument): string {
    const lines: string[] = [];
    lines.push('# Product Requirements Document (PRD)');
    lines.push('');
    lines.push(`**Project ID**: ${prd.project_id}`);
    lines.push(`**Status**: ${prd.status}`);
    lines.push(`**Created**: ${prd.created_at.toISOString()}`);
    if (prd.validated_at) {
      lines.push(`**Validated**: ${prd.validated_at.toISOString()}`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## Vision');
    lines.push('');
    lines.push(prd.vision);
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## User Personas');
    lines.push('');

    prd.personas.forEach((persona, index) => {
      lines.push(`### Persona ${index + 1}: ${persona.role}`);
      if (persona.name) {
        lines.push(`**Name**: ${persona.name}`);
      }
      lines.push('');
      lines.push('#### Needs');
      persona.needs.forEach(need => {
        lines.push(`- ${need}`);
      });
      lines.push('');
      lines.push('#### Goals');
      persona.goals.forEach(goal => {
        lines.push(`- ${goal}`);
      });
      if (persona.pain_points && persona.pain_points.length > 0) {
        lines.push('');
        lines.push('#### Pain Points');
        persona.pain_points.forEach(pp => {
          lines.push(`- ${pp}`);
        });
      }
      if (persona.characteristics && persona.characteristics.length > 0) {
        lines.push('');
        lines.push('#### Characteristics');
        persona.characteristics.forEach(char => {
          lines.push(`- ${char}`);
        });
      }
      lines.push('');
    });

    return lines.join('\n');
  }

  /**
   * Check if PRD is validated (required before moving to next step)
   */
  async isPRDValidated(projectId: string): Promise<boolean> {
    const prd = await this.prdRepo.findByProjectId(projectId);
    return prd !== null && (prd.status === 'validated' || prd.status === 'approved');
  }
}
