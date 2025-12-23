import { ArtifactRepository } from '../repositories/artifactRepository';
import { CreateArtifactRequest, Artifact, ArtifactType } from '@devflow-studio/shared';
import { createFile, readFile, validatePath, ensureDirectory } from '../utils/fileSystem';
import path from 'path';
import * as fs from 'fs/promises';
import { ProjectRepository } from '../repositories/projectRepository';
import { PRDRepository } from '../repositories/prdRepository';

export class ArtifactService {
  private artifactRepo: ArtifactRepository;
  private projectRepo: ProjectRepository;
  private prdRepo: PRDRepository;

  constructor() {
    this.artifactRepo = new ArtifactRepository();
    this.projectRepo = new ProjectRepository();
    this.prdRepo = new PRDRepository();
  }

  async getArtifactsByProject(projectId: string): Promise<Artifact[]> {
    const artifacts = await this.artifactRepo.findByProjectId(projectId);
    
    // Check if ARCHITECTURE.md file exists in filesystem but not in database
    const hasArchitectureArtifact = artifacts.some(a => a.type === 'architecture');
    if (!hasArchitectureArtifact) {
      try {
        const project = await this.projectRepo.findById(projectId);
        if (project) {
          const architecturePath = path.join(project.base_path, 'docs', 'ARCHITECTURE.md');
          try {
            const content = await fs.readFile(architecturePath, 'utf8');
            // File exists but no database record - create the artifact record
            const artifact = await this.artifactRepo.create({
              project_id: projectId,
              type: 'architecture',
              path: architecturePath,
              content: { content },
            });
            artifacts.push(artifact);
          } catch (fileError: any) {
            // File doesn't exist, that's okay
            if (fileError.code !== 'ENOENT') {
              console.error('Error checking for architecture file:', fileError);
            }
          }
        }
      } catch (error) {
        console.error('Error checking for architecture file in filesystem:', error);
      }
    }
    
    return artifacts;
  }

  async getArtifactById(id: string): Promise<Artifact | null> {
    return await this.artifactRepo.findById(id);
  }

  async getArtifactByType(projectId: string, type: ArtifactType): Promise<Artifact | null> {
    return await this.artifactRepo.findByProjectIdAndType(projectId, type);
  }

  async savePRD(projectId: string, content: string): Promise<Artifact> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const filePath = path.join(project.base_path, 'docs', 'PRD.md');
    
    if (!validatePath(filePath, project.base_path)) {
      throw new Error('Invalid file path');
    }

    // Ensure docs directory exists
    const docsDir = path.dirname(filePath);
    await ensureDirectory(docsDir);
    
    // Also ensure the project base directory exists
    await ensureDirectory(project.base_path);

    // Save to file system
    await createFile(filePath, content);

    // Check if artifact already exists
    const existing = await this.artifactRepo.findByProjectIdAndType(projectId, 'prd');
    
    let artifact: Artifact;
    if (existing) {
      // Update existing
      artifact = await this.artifactRepo.update(existing.id, { content }) || existing;
    } else {
      // Create new
      artifact = await this.artifactRepo.create({
        project_id: projectId,
        type: 'prd',
        path: filePath,
        content: { content },
      });
    }

    // Also save to prd_documents table (new system)
    try {
      await this.syncPRDToNewSystem(projectId, content);
    } catch (error) {
      // Log error but don't fail the operation
      console.error('Error syncing PRD to new system:', error);
    }

    return artifact;
  }

  /**
   * Sync PRD content to prd_documents table (new system)
   * Parses markdown content and extracts vision/personas structure
   */
  private async syncPRDToNewSystem(projectId: string, content: string): Promise<void> {
    // Try to parse markdown to extract vision and personas
    const { vision, personas } = this.parsePRDMarkdown(content);

    // Check if PRD already exists in new system
    const existingPRD = await this.prdRepo.findByProjectId(projectId);
    
    if (existingPRD) {
      // Update existing PRD
      // Always set to 'validated' when syncing from old system (user saved it, so it's ready)
      await this.prdRepo.update(existingPRD.id, {
        vision,
        personas,
        status: 'validated',
      });
    } else {
      // Create new PRD in new system
      // Auto-validate since user saved it (they consider it ready to use)
      await this.prdRepo.create({
        project_id: projectId,
        vision,
        personas,
        status: 'validated',
      });
    }
  }

  /**
   * Parse PRD markdown to extract vision and personas
   */
  private parsePRDMarkdown(content: string): { vision: string; personas: any[] } {
    // Extract vision (usually in a section like "## Vision" or "## Problem Statement")
    let vision = '';
    const visionMatch = content.match(/##\s*(?:Vision|Problem Statement|Overview)([\s\S]*?)(?=##|$)/i);
    if (visionMatch) {
      vision = visionMatch[1].trim();
    } else {
      // Fallback: use first substantial paragraph as vision
      const lines = content.split('\n').filter(line => line.trim() && !line.startsWith('#'));
      vision = lines.slice(0, 5).join('\n').trim() || content.substring(0, 500);
    }

    // Extract personas (usually in "## Target Users" or "## User Personas")
    const personas: any[] = [];
    const personasMatch = content.match(/##\s*(?:Target Users|User Personas|Personas)([\s\S]*?)(?=##|$)/i);
    if (personasMatch) {
      const personasSection = personasMatch[1];
      // Try to parse list items as personas
      const lines = personasSection.split('\n');
      let currentPersona: any = null;
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('<!--')) continue;
        
        // Check for persona headers (### Name or **Name**)
        const headerMatch = trimmed.match(/###\s+(.+)|^\*\*(.+)\*\*/);
        if (headerMatch) {
          if (currentPersona && currentPersona.role) {
            personas.push(currentPersona);
          }
          const role = headerMatch[1] || headerMatch[2];
          currentPersona = {
            role: role.trim(),
            needs: [],
            goals: [],
            pain_points: [],
          };
        } else if (currentPersona && trimmed.match(/^[-*•]\s*(.+)/)) {
          const item = trimmed.replace(/^[-*•]\s*/, '').trim();
          // Try to categorize as need or goal based on context
          if (!currentPersona.needs.length || currentPersona.needs.length < 3) {
            currentPersona.needs.push(item);
          } else {
            currentPersona.goals.push(item);
          }
        }
      }
      
      if (currentPersona && currentPersona.role) {
        personas.push(currentPersona);
      }
    }

    // If no personas found, create a default one
    if (personas.length === 0) {
      personas.push({
        role: 'Usuario',
        needs: ['Acceder a las funcionalidades del sistema'],
        goals: ['Completar tareas de manera eficiente'],
        pain_points: [],
      });
    }

    return { vision, personas };
  }

  async saveArchitecture(projectId: string, content: string): Promise<Artifact> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const filePath = path.join(project.base_path, 'docs', 'ARCHITECTURE.md');
    
    if (!validatePath(filePath, project.base_path)) {
      throw new Error('Invalid file path');
    }

    // Ensure project base directory exists first
    await ensureDirectory(project.base_path);
    
    // Ensure docs directory exists
    const docsDir = path.dirname(filePath);
    await ensureDirectory(docsDir);

    // Save to file system
    await createFile(filePath, content);

    // Check if artifact already exists
    const existing = await this.artifactRepo.findByProjectIdAndType(projectId, 'architecture');
    
    if (existing) {
      // Update existing
      return await this.artifactRepo.update(existing.id, { content }) || existing;
    } else {
      // Create new
      return await this.artifactRepo.create({
        project_id: projectId,
        type: 'architecture',
        path: filePath,
        content: { content },
      });
    }
  }

  async saveArtifact(data: CreateArtifactRequest, fileContent?: string): Promise<Artifact> {
    const project = await this.projectRepo.findById(data.project_id);
    if (!project) {
      throw new Error('Project not found');
    }

    const fullPath = path.join(project.base_path, data.path);
    
    if (!validatePath(fullPath, project.base_path)) {
      throw new Error('Invalid file path');
    }

    // Save to file system if content provided
    if (fileContent !== undefined) {
      await createFile(fullPath, fileContent);
    }

    return await this.artifactRepo.create(data);
  }

  async readArtifactFile(artifactId: string): Promise<string> {
    const artifact = await this.artifactRepo.findById(artifactId);
    if (!artifact) {
      throw new Error('Artifact not found');
    }

    try {
      return await readFile(artifact.path);
    } catch (error: any) {
      // If file doesn't exist, return empty string instead of throwing
      // This can happen if artifact exists in DB but file hasn't been created yet
      if (error.code === 'ENOENT') {
        return '';
      }
      throw error;
    }
  }

  async saveADR(projectId: string, content: string, adrNumber?: number): Promise<Artifact> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    // If adrNumber is provided, use it; otherwise, find the next available number
    let adrNum = adrNumber;
    if (adrNum === undefined) {
      // Find all existing ADRs to determine next number
      const existingADRs = await this.artifactRepo.findByProjectId(projectId);
      const adrArtifacts = existingADRs.filter(a => a.type === 'adr');
      adrNum = adrArtifacts.length + 1;
    }

    const fileName = `ADR-${adrNum.toString().padStart(3, '0')}.md`;
    const filePath = path.join(project.base_path, 'docs', 'adr', fileName);
    
    if (!validatePath(filePath, project.base_path)) {
      throw new Error('Invalid file path');
    }

    // Save to file system
    await createFile(filePath, content);

    // Create new ADR (each ADR is a separate artifact)
    return await this.artifactRepo.create({
      project_id: projectId,
      type: 'adr',
      path: filePath,
      content: { content, adrNumber: adrNum },
    });
  }

  async getADRsByProject(projectId: string): Promise<Artifact[]> {
    const artifacts = await this.artifactRepo.findByProjectId(projectId);
    return artifacts.filter(a => a.type === 'adr').sort((a, b) => {
      const aNum = (a.content as any)?.adrNumber || 0;
      const bNum = (b.content as any)?.adrNumber || 0;
      return aNum - bNum;
    });
  }

  async deleteADR(adrId: string): Promise<boolean> {
    return await this.artifactRepo.delete(adrId);
  }
}

