import { ArtifactRepository } from '../repositories/artifactRepository';
import { CreateArtifactRequest, Artifact, ArtifactType } from '@devflow-studio/shared';
import { createFile, readFile, validatePath } from '../utils/fileSystem';
import path from 'path';
import { ProjectRepository } from '../repositories/projectRepository';

export class ArtifactService {
  private artifactRepo: ArtifactRepository;
  private projectRepo: ProjectRepository;

  constructor() {
    this.artifactRepo = new ArtifactRepository();
    this.projectRepo = new ProjectRepository();
  }

  async getArtifactsByProject(projectId: string): Promise<Artifact[]> {
    return await this.artifactRepo.findByProjectId(projectId);
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

    const filePath = path.join(project.base_path, 'artifacts', 'PRD.md');
    
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

    const filePath = path.join(project.base_path, 'artifacts', 'ARCHITECTURE.md');
    
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

  async saveArchitecture(projectId: string, content: string): Promise<Artifact> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const filePath = path.join(project.base_path, 'artifacts', 'ARCHITECTURE.md');
    
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

  async readArtifactFile(artifactId: string): Promise<string> {
    const artifact = await this.artifactRepo.findById(artifactId);
    if (!artifact) {
      throw new Error('Artifact not found');
    }

    return await readFile(artifact.path);
  }
}

