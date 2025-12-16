import { CodingSessionRepository } from '../repositories/codingSessionRepository';
import { TaskRepository } from '../repositories/taskRepository';
import { AIService } from './aiService';
import { 
  CodingSession, 
  CreateCodingSessionRequest, 
  StartImplementationRequest,
  ProgrammerType,
  ImplementationDashboard
} from '@devflow-studio/shared';

export class CodingSessionService {
  private sessionRepo: CodingSessionRepository;
  private taskRepo: TaskRepository;
  private aiService: AIService;

  constructor() {
    this.sessionRepo = new CodingSessionRepository();
    this.taskRepo = new TaskRepository();
    this.aiService = new AIService();
  }

  /**
   * Create a single coding session for a user story
   */
  async createSession(data: CreateCodingSessionRequest): Promise<CodingSession> {
    // Verify story exists
    const story = await this.taskRepo.findById(data.story_id);
    if (!story) {
      throw new Error('User story not found');
    }

    if (story.type !== 'story') {
      throw new Error('Task is not a user story');
    }

    // Check if session already exists for this story
    const existingSession = await this.sessionRepo.findByStoryId(data.story_id);
    if (existingSession && existingSession.status !== 'failed') {
      throw new Error('Coding session already exists for this story');
    }

    // Create coding session first (without AI job)
    const session = await this.sessionRepo.create({
      project_id: data.project_id,
      story_id: data.story_id,
      programmer_type: data.programmer_type,
    });

    // Create AI job for code generation with session_id in args
    const prompt = this.buildCodingPrompt(story, data.programmer_type);
    const aiJob = await this.aiService.createAIJob({
      project_id: data.project_id,
      task_id: data.story_id,
      provider: data.provider || 'cursor',
      mode: 'agent', // Use agent mode for code generation
      prompt,
    });

    // Update session with AI job ID
    // Also inject coding_session_id into AI job args
    await this.sessionRepo.update(session.id, {
      ai_job_id: aiJob.id,
    });

    // Update AI job args to include coding_session_id
    const { Pool } = await import('pg');
    const pool = (await import('../config/database')).default;
    await pool.query(
      `UPDATE ai_jobs SET args = args || $1::jsonb WHERE id = $2`,
      [JSON.stringify({ coding_session_id: session.id }), aiJob.id]
    );

    return session;
  }

  /**
   * Start implementation for multiple stories
   */
  async startImplementation(data: StartImplementationRequest): Promise<CodingSession[]> {
    const sessions: CodingSession[] = [];

    for (const storyId of data.story_ids) {
      const story = await this.taskRepo.findById(storyId);
      if (!story) {
        console.warn(`Story ${storyId} not found, skipping`);
        continue;
      }

      // Auto-assign programmer type based on story context if enabled
      let programmerType: ProgrammerType = 'fullstack';
      if (data.auto_assign) {
        programmerType = this.detectProgrammerType(story);
      }

      try {
        const session = await this.createSession({
          project_id: data.project_id,
          story_id: storyId,
          programmer_type: programmerType,
        });
        sessions.push(session);
      } catch (error: any) {
        console.error(`Failed to create session for story ${storyId}:`, error.message);
      }
    }

    return sessions;
  }

  /**
   * Get implementation dashboard for a project
   */
  async getDashboard(projectId: string): Promise<ImplementationDashboard> {
    return await this.sessionRepo.getDashboard(projectId);
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<CodingSession | null> {
    return await this.sessionRepo.findById(sessionId);
  }

  /**
   * Get all sessions for a project
   */
  async getProjectSessions(projectId: string): Promise<CodingSession[]> {
    return await this.sessionRepo.findByProjectId(projectId);
  }

  /**
   * Update session progress (called by worker)
   */
  async updateProgress(sessionId: string, progress: number, currentFile?: string): Promise<void> {
    await this.sessionRepo.update(sessionId, {
      progress,
      current_file: currentFile,
    });

    // Add event for real-time updates
    await this.sessionRepo.addEvent(sessionId, 'progress', {
      progress,
      current_file: currentFile,
    });
  }

  /**
   * Add output to session (called by worker)
   */
  async addOutput(sessionId: string, output: string): Promise<void> {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) return;

    const updatedOutput = (session.output || '') + output;
    await this.sessionRepo.update(sessionId, {
      output: updatedOutput,
    });

    // Add event for real-time updates
    await this.sessionRepo.addEvent(sessionId, 'output', {
      output,
    });
  }

  /**
   * Mark session as completed
   */
  async completeSession(sessionId: string): Promise<void> {
    await this.sessionRepo.update(sessionId, {
      status: 'completed',
      progress: 100,
      completed_at: new Date(),
    });

    // Add event
    await this.sessionRepo.addEvent(sessionId, 'completed', {
      message: 'Coding session completed successfully',
    });
  }

  /**
   * Mark session as failed
   */
  async failSession(sessionId: string, error: string): Promise<void> {
    await this.sessionRepo.update(sessionId, {
      status: 'failed',
      error,
      completed_at: new Date(),
    });

    // Add event
    await this.sessionRepo.addEvent(sessionId, 'error', {
      error,
    });
  }

  /**
   * Get session events for streaming
   */
  async getSessionEvents(sessionId: string, since?: Date) {
    if (since) {
      return await this.sessionRepo.getRecentEvents(sessionId, since);
    }
    return await this.sessionRepo.getEvents(sessionId, 100);
  }

  /**
   * Build coding prompt based on story and programmer type
   */
  private buildCodingPrompt(story: any, programmerType: ProgrammerType): string {
    const lines: string[] = [];

    lines.push(`# Coding Task: ${story.title}\n`);
    lines.push(`**Programmer Type**: ${programmerType}\n`);
    lines.push(`**Priority**: ${story.priority}\n\n`);

    if (story.description) {
      lines.push(`## User Story\n`);
      lines.push(`${story.description}\n\n`);
    }

    lines.push(`## Instructions\n`);
    
    if (programmerType === 'backend') {
      lines.push(`You are a backend developer. Focus on:`);
      lines.push(`- Implementing API endpoints and routes`);
      lines.push(`- Database models and repositories`);
      lines.push(`- Business logic and services`);
      lines.push(`- Error handling and validation`);
      lines.push(`- Following REST/GraphQL best practices\n`);
    } else if (programmerType === 'frontend') {
      lines.push(`You are a frontend developer. Focus on:`);
      lines.push(`- Creating React components`);
      lines.push(`- Implementing UI/UX designs`);
      lines.push(`- State management and API integration`);
      lines.push(`- Responsive design and accessibility`);
      lines.push(`- Following modern frontend best practices\n`);
    } else {
      lines.push(`You are a fullstack developer. Implement both:`);
      lines.push(`- Backend: API endpoints, services, and database operations`);
      lines.push(`- Frontend: React components and UI implementation`);
      lines.push(`- Ensure proper integration between frontend and backend\n`);
    }

    lines.push(`\nImplement this user story following the project's architecture and coding standards.`);
    lines.push(`Write clean, maintainable, and well-documented code.`);

    return lines.join('\n');
  }

  /**
   * Detect programmer type from story context
   */
  private detectProgrammerType(story: any): ProgrammerType {
    const text = `${story.title} ${story.description || ''}`.toLowerCase();

    const backendKeywords = ['api', 'endpoint', 'database', 'backend', 'server', 'service', 'repository'];
    const frontendKeywords = ['ui', 'component', 'page', 'frontend', 'interface', 'button', 'form', 'display'];

    const hasBackend = backendKeywords.some(keyword => text.includes(keyword));
    const hasFrontend = frontendKeywords.some(keyword => text.includes(keyword));

    if (hasBackend && hasFrontend) return 'fullstack';
    if (hasBackend) return 'backend';
    if (hasFrontend) return 'frontend';
    
    return 'fullstack'; // Default
  }
}
