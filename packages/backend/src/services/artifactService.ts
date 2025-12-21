import { ArtifactRepository } from '../repositories/artifactRepository';
import { CreateArtifactRequest, Artifact, ArtifactType } from '@devflow-studio/shared';
import { createFile, readFile, validatePath } from '../utils/fileSystem';
import path from 'path';
import * as fs from 'fs/promises';
import { ProjectRepository } from '../repositories/projectRepository';

export class ArtifactService {
  private artifactRepo: ArtifactRepository;
  private projectRepo: ProjectRepository;

  constructor() {
    this.artifactRepo = new ArtifactRepository();
    this.projectRepo = new ProjectRepository();
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

    // Save to file system
    await createFile(filePath, content);

    // Check if artifact already exists
    const existing = await this.artifactRepo.findByProjectIdAndType(projectId, 'prd');
    
    if (existing) {
      // Update existing
      return await this.artifactRepo.update(existing.id, { content }) || existing;
    } else {
      // Create new
      return await this.artifactRepo.create({
        project_id: projectId,
        type: 'prd',
        path: filePath,
        content: { content },
      });
    }
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

    return await readFile(artifact.path);
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

