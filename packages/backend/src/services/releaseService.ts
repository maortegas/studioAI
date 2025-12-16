import { ReleaseRepository } from '../repositories/releaseRepository';
import { ProjectRepository } from '../repositories/projectRepository';
import { ArtifactRepository } from '../repositories/artifactRepository';
import { QARepository } from '../repositories/qaRepository';
import { TestSuiteRepository } from '../repositories/testSuiteRepository';
import { CodingSessionRepository } from '../repositories/codingSessionRepository';
import { TaskRepository } from '../repositories/taskRepository';
import {
  Release,
  CreateReleaseRequest,
  UpdateReleaseRequest,
  ReleaseSummary,
} from '@devflow-studio/shared';
import path from 'path';
import fs from 'fs/promises';

export class ReleaseService {
  private releaseRepo: ReleaseRepository;
  private projectRepo: ProjectRepository;
  private artifactRepo: ArtifactRepository;
  private qaRepo: QARepository;
  private testSuiteRepo: TestSuiteRepository;
  private codingSessionRepo: CodingSessionRepository;
  private taskRepo: TaskRepository;

  constructor() {
    this.releaseRepo = new ReleaseRepository();
    this.projectRepo = new ProjectRepository();
    this.artifactRepo = new ArtifactRepository();
    this.qaRepo = new QARepository();
    this.testSuiteRepo = new TestSuiteRepository();
    this.codingSessionRepo = new CodingSessionRepository();
    this.taskRepo = new TaskRepository();
  }

  async createRelease(data: CreateReleaseRequest): Promise<Release> {
    // Validate project exists
    const project = await this.projectRepo.findById(data.project_id);
    if (!project) {
      throw new Error('Project not found');
    }

    // Check if version already exists
    const existing = await this.releaseRepo.findByVersion(data.project_id, data.version);
    if (existing) {
      throw new Error(`Version ${data.version} already exists for this project`);
    }

    // Auto-generate changelog if not provided
    if (!data.changelog) {
      data.changelog = await this.generateChangelog(data.project_id);
    }

    // Auto-collect artifacts if not provided
    if (!data.artifacts || data.artifacts.length === 0) {
      data.artifacts = await this.collectArtifacts(data.project_id);
    }

    // Auto-collect metadata
    if (!data.metadata) {
      data.metadata = await this.collectMetadata(data.project_id);
    }

    return await this.releaseRepo.create(data);
  }

  async getRelease(id: string): Promise<Release> {
    const release = await this.releaseRepo.findById(id);
    if (!release) {
      throw new Error('Release not found');
    }
    return release;
  }

  async getReleasesByProject(projectId: string): Promise<Release[]> {
    return await this.releaseRepo.findByProject(projectId);
  }

  async updateRelease(id: string, data: UpdateReleaseRequest): Promise<Release> {
    const existing = await this.releaseRepo.findById(id);
    if (!existing) {
      throw new Error('Release not found');
    }

    // If version is being updated, check for conflicts
    if (data.version && data.version !== existing.version) {
      const conflict = await this.releaseRepo.findByVersion(existing.project_id, data.version);
      if (conflict && conflict.id !== id) {
        throw new Error(`Version ${data.version} already exists for this project`);
      }
    }

    return await this.releaseRepo.update(id, data);
  }

  async deleteRelease(id: string): Promise<void> {
    const release = await this.releaseRepo.findById(id);
    if (!release) {
      throw new Error('Release not found');
    }

    // Only allow deletion of draft releases
    if (release.status !== 'draft') {
      throw new Error('Only draft releases can be deleted');
    }

    await this.releaseRepo.delete(id);
  }

  async publishRelease(id: string): Promise<Release> {
    const release = await this.releaseRepo.findById(id);
    if (!release) {
      throw new Error('Release not found');
    }

    if (release.status === 'published') {
      throw new Error('Release is already published');
    }

    // Update status to published and set release date
    return await this.releaseRepo.update(id, {
      status: 'published',
      release_date: new Date(),
    });
  }

  async getReleaseSummary(projectId: string): Promise<ReleaseSummary> {
    return await this.releaseRepo.getSummary(projectId);
  }

  /**
   * Generate changelog from completed coding sessions and QA results
   */
  private async generateChangelog(projectId: string): Promise<string> {
    const lines: string[] = [];
    lines.push('# Changelog\n\n');

    // Get completed coding sessions
    const codingSessions = await this.codingSessionRepo.findByProjectId(projectId);
    const completedSessions = codingSessions.filter(s => s.status === 'completed');

    if (completedSessions.length > 0) {
      lines.push('## Implemented Features\n\n');
      for (const session of completedSessions) {
        // Get story details
        const story = await this.taskRepo.findById(session.story_id);
        if (story) {
          lines.push(`- **${story.title}**`);
          if (story.description) {
            lines.push(`  ${story.description.substring(0, 200)}`);
          }
          lines.push('');
        }
      }
    }

    // Get QA results
    const qaSessions = await this.qaRepo.findByProjectId(projectId);
    const completedQA = qaSessions.filter(qa => qa.status === 'completed');

    if (completedQA.length > 0) {
      lines.push('## Quality Assurance\n\n');
      for (const qa of completedQA) {
        lines.push(`- QA Session: ${qa.total_tests || 0} tests`);
        if (qa.passed_tests) {
          lines.push(`  - Passed: ${qa.passed_tests}`);
        }
        if (qa.failed_tests) {
          lines.push(`  - Failed: ${qa.failed_tests}`);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Collect relevant artifacts for the release
   */
  private async collectArtifacts(projectId: string): Promise<string[]> {
    const artifacts = await this.artifactRepo.findByProjectId(projectId);
    const artifactIds: string[] = [];

    // Include key artifacts
    for (const artifact of artifacts) {
      if (['architecture', 'roadmap', 'prd'].includes(artifact.type)) {
        artifactIds.push(artifact.id);
      }
    }

    return artifactIds;
  }

  /**
   * Collect metadata about the project state
   */
  private async collectMetadata(projectId: string): Promise<any> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      return {};
    }

    // Get coding sessions summary
    const codingSessions = await this.codingSessionRepo.findByProjectId(projectId);
    const completedSessions = codingSessions.filter(s => s.status === 'completed');

    // Get QA summary
    const qaSessions = await this.qaRepo.findByProjectId(projectId);
    const completedQA = qaSessions.filter(qa => qa.status === 'completed');

    // Get test suites summary
    const testSuites = await this.testSuiteRepo.findByProject(projectId);
    const passedSuites = testSuites.filter(ts => ts.status === 'passed');

    return {
      build_info: {
        tech_stack: project.tech_stack,
        project_name: project.name,
      },
      test_results: {
        total_suites: testSuites.length,
        passed_suites: passedSuites.length,
      },
      qa_summary: {
        total_sessions: qaSessions.length,
        completed_sessions: completedQA.length,
        total_tests: completedQA.reduce((sum, qa) => sum + (qa.total_tests || 0), 0),
        passed_tests: completedQA.reduce((sum, qa) => sum + (qa.passed_tests || 0), 0),
      },
      implementation: {
        total_sessions: codingSessions.length,
        completed_sessions: completedSessions.length,
      },
    };
  }
}
