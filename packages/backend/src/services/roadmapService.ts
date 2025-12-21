import { Roadmap, CreateRoadmapRequest, UpdateRoadmapRequest, RoadmapMilestone } from '@devflow-studio/shared';
import { ArtifactService } from './artifactService';
import { TaskRepository } from '../repositories/taskRepository';
import { ProjectRepository } from '../repositories/projectRepository';
import { createFile } from '../utils/fileSystem';
import path from 'path';

export class RoadmapService {
  private artifactService: ArtifactService;
  private taskRepo: TaskRepository;
  private projectRepo: ProjectRepository;

  constructor() {
    this.artifactService = new ArtifactService();
    this.taskRepo = new TaskRepository();
    this.projectRepo = new ProjectRepository();
  }

  /**
   * Create a roadmap manually
   */
  async createRoadmap(data: CreateRoadmapRequest): Promise<Roadmap> {
    const project = await this.projectRepo.findById(data.project_id);
    if (!project) {
      throw new Error('Project not found');
    }

    // Create milestone tasks
    const milestoneTasks: any[] = [];
    for (const milestone of data.milestones) {
      const task = await this.taskRepo.create({
        project_id: data.project_id,
        title: milestone.title,
        description: milestone.description,
        type: 'milestone',
        status: milestone.status,
        priority: milestone.priority,
      });
      milestoneTasks.push(task);
    }

    // Create roadmap artifact
    const roadmapData: Roadmap = {
      project_id: data.project_id,
      title: data.title,
      description: data.description,
      milestones: data.milestones.map((m: RoadmapMilestone, index: number) => ({
        ...m,
        id: milestoneTasks[index].id,
      })),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const filePath = path.join(project.base_path, 'docs', 'ROADMAP.md');
    const markdownContent = this.generateRoadmapMarkdown(roadmapData);

    await createFile(filePath, markdownContent);

    // Check if roadmap artifact already exists
    const existing = await this.artifactService.getArtifactByType(data.project_id, 'roadmap');
    
    if (existing) {
      // Update existing artifact - file is already created above
      const artifactRepo = (this.artifactService as any).artifactRepo;
      await artifactRepo.update(existing.id, roadmapData);
    } else {
      // Create new artifact
      await this.artifactService.saveArtifact(
        {
          project_id: data.project_id,
          type: 'roadmap',
          path: 'docs/ROADMAP.md',
          content: roadmapData,
        },
        markdownContent
      );
    }

    return roadmapData;
  }

  /**
   * Update an existing roadmap
   */
  async updateRoadmap(projectId: string, data: UpdateRoadmapRequest): Promise<Roadmap> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const existingRoadmap = await this.artifactService.getArtifactByType(projectId, 'roadmap');
    if (!existingRoadmap) {
      throw new Error('Roadmap not found');
    }

    const currentRoadmap = existingRoadmap.content as Roadmap;
    
    // Update roadmap data
    const updatedRoadmap: Roadmap = {
      ...currentRoadmap,
      title: data.title ?? currentRoadmap.title,
      description: data.description ?? currentRoadmap.description,
      milestones: data.milestones ?? currentRoadmap.milestones,
      updatedAt: new Date(),
    };

    // Update milestone tasks if milestones changed
    if (data.milestones) {
      // Get existing milestones
      const existingMilestones = await this.taskRepo.findByProjectIdAndType(projectId, 'milestone');
      const existingMilestoneMap = new Map(existingMilestones.map(m => [m.id, m]));

      // Update or create milestones
      for (const milestone of data.milestones) {
        if (milestone.id && existingMilestoneMap.has(milestone.id)) {
          // Update existing milestone
          await this.taskRepo.update(milestone.id, {
            title: milestone.title,
            description: milestone.description,
            status: milestone.status,
            priority: milestone.priority,
          });
        } else {
          // Create new milestone
          const task = await this.taskRepo.create({
            project_id: projectId,
            title: milestone.title,
            description: milestone.description,
            type: 'milestone',
            status: milestone.status,
            priority: milestone.priority,
          });
          milestone.id = task.id;
        }
      }

      // Delete milestones that are no longer in the roadmap
      const newMilestoneIds = new Set(data.milestones.map((m: RoadmapMilestone) => m.id).filter(Boolean));
      for (const existingMilestone of existingMilestones) {
        if (!newMilestoneIds.has(existingMilestone.id)) {
          await this.taskRepo.delete(existingMilestone.id);
        }
      }
    }

    // Update artifact file and content
    const filePath = path.join(project.base_path, 'docs', 'ROADMAP.md');
    const markdownContent = this.generateRoadmapMarkdown(updatedRoadmap);
    
    // Update file system
    await createFile(filePath, markdownContent);
    
    // Update artifact in database
    const artifactRepo = (this.artifactService as any).artifactRepo;
    await artifactRepo.update(existingRoadmap.id, updatedRoadmap);

    return updatedRoadmap;
  }

  /**
   * Get roadmap for a project
   */
  async getRoadmapByProject(projectId: string): Promise<Roadmap | null> {
    try {
      const artifact = await this.artifactService.getArtifactByType(projectId, 'roadmap');
      if (!artifact || !artifact.content) {
        return null;
      }

      const roadmap = artifact.content as Roadmap;
      if (!roadmap || !roadmap.milestones) {
        return null;
      }

      const milestones = await this.taskRepo.findByProjectIdAndType(projectId, 'milestone');
      
      // Merge milestone data from tasks
      const updatedMilestones = roadmap.milestones.map((m: RoadmapMilestone) => {
        const task = milestones.find(t => t.id === m.id);
        if (task) {
          return {
            ...m,
            title: task.title,
            description: task.description,
            status: task.status,
            priority: task.priority,
          };
        }
        return m;
      });

      return {
        ...roadmap,
        milestones: updatedMilestones,
      };
    } catch (error) {
      console.error('Error getting roadmap by project:', error);
      return null;
    }
  }

  /**
   * Generate markdown content for roadmap
   */
  private generateRoadmapMarkdown(roadmap: Roadmap): string {
    const lines: string[] = [];
    
    lines.push(`# ${roadmap.title}\n`);
    
    if (roadmap.description) {
      lines.push(`${roadmap.description}\n`);
    }
    
    lines.push('\n## Milestones\n');
    
    for (const milestone of roadmap.milestones) {
      lines.push(`### ${milestone.title}\n`);
      
      if (milestone.description) {
        lines.push(`${milestone.description}\n`);
      }
      
      lines.push(`- **Status**: ${milestone.status}`);
      lines.push(`- **Priority**: ${milestone.priority}`);
      
      if (milestone.targetDate) {
        lines.push(`- **Target Date**: ${milestone.targetDate}`);
      }
      
      if (milestone.dependencies && milestone.dependencies.length > 0) {
        lines.push(`- **Dependencies**: ${milestone.dependencies.join(', ')}`);
      }
      
      lines.push('');
    }
    
    return lines.join('\n');
  }
}

