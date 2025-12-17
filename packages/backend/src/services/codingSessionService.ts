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

    const { Pool } = await import('pg');
    const pool = (await import('../config/database')).default;
    const testStrategy = data.test_strategy || 'tdd';

    // Store test strategy in session metadata (using a custom field or we can add it to the database schema later)
    // For now, we'll pass it via AI job args

    if (testStrategy === 'tdd') {
      // TDD: Generate tests BEFORE implementation
      // Step 1: Create AI job for TEST GENERATION first
      const testPrompt = this.buildTestGenerationPrompt(story, data.programmer_type, true);
      const testJob = await this.aiService.createAIJob({
        project_id: data.project_id,
        task_id: data.story_id,
        provider: data.provider || 'cursor',
        mode: 'agent',
        prompt: testPrompt,
      });

      await this.sessionRepo.update(session.id, {
        status: 'generating_tests',
        test_generation_job_id: testJob.id,
        progress: 0,
        test_progress: 0,
        implementation_progress: 0,
      });

      // Update AI job args to include coding_session_id and test_strategy
      await pool.query(
        `UPDATE ai_jobs SET args = args || $1::jsonb WHERE id = $2`,
        [JSON.stringify({ coding_session_id: session.id, phase: 'test_generation', test_strategy: 'tdd', unit_tests_only: true }), testJob.id]
      );
    } else if (testStrategy === 'after') {
      // 'after': Skip test generation, start implementation directly, generate tests after
      const implementationPrompt = this.buildImplementationPrompt(story, data.programmer_type, undefined);
      const implJob = await this.aiService.createAIJob({
        project_id: data.project_id,
        task_id: data.story_id,
        provider: data.provider || 'cursor',
        mode: 'agent',
        prompt: implementationPrompt,
      });

      await this.sessionRepo.update(session.id, {
        status: 'running',
        ai_job_id: implJob.id,
        implementation_job_id: implJob.id,
        progress: 0,
        test_progress: 0,
        implementation_progress: 0,
      });

      // Update AI job args to include coding_session_id and test_strategy
      await pool.query(
        `UPDATE ai_jobs SET args = args || $1::jsonb WHERE id = $2`,
        [JSON.stringify({ coding_session_id: session.id, phase: 'implementation', test_strategy: 'after', unit_tests_only: true }), implJob.id]
      );
    } else {
      // 'none': Skip test generation entirely, start implementation directly, no tests after
      const implementationPrompt = this.buildImplementationPrompt(story, data.programmer_type, undefined);
      const implJob = await this.aiService.createAIJob({
        project_id: data.project_id,
        task_id: data.story_id,
        provider: data.provider || 'cursor',
        mode: 'agent',
        prompt: implementationPrompt,
      });

      await this.sessionRepo.update(session.id, {
        status: 'running',
        ai_job_id: implJob.id,
        implementation_job_id: implJob.id,
        progress: 0,
        test_progress: 0,
        implementation_progress: 0,
      });

      // Update AI job args to include coding_session_id and test_strategy
      await pool.query(
        `UPDATE ai_jobs SET args = args || $1::jsonb WHERE id = $2`,
        [JSON.stringify({ coding_session_id: session.id, phase: 'implementation', test_strategy: 'none' }), implJob.id]
      );
    }

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
          test_strategy: data.test_strategy || 'tdd',
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
   * Pause a running session
   */
  async pauseSession(sessionId: string): Promise<void> {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    if (session.status !== 'running') {
      throw new Error('Only running sessions can be paused');
    }

    await this.sessionRepo.update(sessionId, {
      status: 'paused',
    });

    // Add event
    await this.sessionRepo.addEvent(sessionId, 'progress', {
      message: 'Session paused by user',
    });
  }

  /**
   * Resume a paused session
   */
  async resumeSession(sessionId: string): Promise<void> {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    if (session.status !== 'paused') {
      throw new Error('Only paused sessions can be resumed');
    }

    // For now, we'll mark it as pending so the worker can pick it up again
    // In a real implementation, you'd need to handle resume logic in the worker
    await this.sessionRepo.update(sessionId, {
      status: 'pending',
    });

    // Add event
    await this.sessionRepo.addEvent(sessionId, 'progress', {
      message: 'Session resumed by user',
    });
  }

  /**
   * Delete/Cancel a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    // If session is running, mark as cancelled instead of deleting
    if (session.status === 'running' || session.status === 'pending') {
      await this.sessionRepo.update(sessionId, {
        status: 'failed',
        error: 'Cancelled by user',
        completed_at: new Date(),
      });

      // Add event
      await this.sessionRepo.addEvent(sessionId, 'error', {
        error: 'Session cancelled by user',
      });
    } else {
      // Delete completed/failed sessions
      await this.sessionRepo.delete(sessionId);
    }
  }

  /**
   * Retry a failed session
   */
  async retrySession(sessionId: string): Promise<CodingSession> {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    if (session.status !== 'failed') {
      throw new Error('Only failed sessions can be retried');
    }

    // Get the original story
    const story = await this.taskRepo.findById(session.story_id);
    if (!story) {
      throw new Error('Story not found');
    }

    // Create a new session
    const newSession = await this.createSession({
      project_id: session.project_id,
      story_id: session.story_id,
      programmer_type: session.programmer_type,
    });

    // Delete the old failed session
    await this.sessionRepo.delete(sessionId);

    return newSession;
  }

  /**
   * Build test generation prompt
   */
  private buildTestGenerationPrompt(story: any, programmerType: ProgrammerType, unitTestsOnly: boolean = true): string {
    const lines: string[] = [];

    lines.push(`# Test Generation Task: ${story.title}\n`);
    lines.push(`**Programmer Type**: ${programmerType}\n`);
    lines.push(`**Priority**: ${story.priority}\n\n`);

    if (story.description) {
      lines.push(`## User Story\n`);
      lines.push(`${story.description}\n\n`);
    }

    lines.push(`## Instructions\n`);
    lines.push(`You are a QA engineer. Your task is to generate comprehensive test suites BEFORE implementation.\n\n`);
    
    if (unitTestsOnly) {
      lines.push(`**IMPORTANT: Generate ONLY unit tests. Do NOT generate integration tests, E2E tests, or load tests.**\n\n`);
      lines.push(`Unit tests should test individual functions, methods, or components in isolation.\n\n`);
    }
    
    if (programmerType === 'backend') {
      lines.push(`Generate ${unitTestsOnly ? 'UNIT ' : ''}tests for:`);
      lines.push(`- Individual functions and methods`);
      lines.push(`- Business logic and services (in isolation)`);
      lines.push(`- Error handling and validation\n`);
      if (!unitTestsOnly) {
        lines.push(`- API endpoints and routes`);
        lines.push(`- Database models and repositories\n`);
      }
      lines.push(`Use testing frameworks like Jest, Mocha, or similar.\n`);
    } else if (programmerType === 'frontend') {
      lines.push(`Generate ${unitTestsOnly ? 'UNIT ' : ''}tests for:`);
      lines.push(`- Individual React components (in isolation)`);
      lines.push(`- Component props and rendering`);
      lines.push(`- Component state and methods\n`);
      if (!unitTestsOnly) {
        lines.push(`- User interactions and UI flows`);
        lines.push(`- State management`);
        lines.push(`- API integration\n`);
      }
      lines.push(`Use testing frameworks like Jest, React Testing Library, or similar.\n`);
    } else {
      lines.push(`Generate ${unitTestsOnly ? 'UNIT ' : ''}tests for both:`);
      lines.push(`- Backend: Individual functions, methods, business logic (in isolation)`);
      lines.push(`- Frontend: Individual components, props, state (in isolation)\n`);
      if (!unitTestsOnly) {
        lines.push(`- Backend: API endpoints, services, database operations`);
        lines.push(`- Frontend: User flows, state management\n`);
      }
    }

    lines.push(`\n## Output Format\n`);
    lines.push(`Provide the test code in the following format:\n`);
    lines.push(`\`\`\`\n`);
    lines.push(`// Test file path: path/to/test/file.test.js\n`);
    lines.push(`// Test code here...\n`);
    lines.push(`\`\`\`\n`);
    lines.push(`\nGenerate complete, runnable ${unitTestsOnly ? 'unit ' : ''}test suites that cover all acceptance criteria from the user story.`);

    return lines.join('\n');
  }

  /**
   * Build implementation prompt (alias for buildCodingPrompt)
   */
  private buildImplementationPrompt(story: any, programmerType: ProgrammerType, testsOutput?: string): string {
    return this.buildCodingPrompt(story, programmerType, testsOutput);
  }

  /**
   * Build implementation prompt based on story, programmer type, and generated tests
   */
  private buildCodingPrompt(story: any, programmerType: ProgrammerType, testsOutput?: string): string {
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

    if (testsOutput) {
      lines.push(`\n## Generated Tests\n`);
      lines.push(`The following tests have been generated. Implement the code to make these tests pass:\n`);
      lines.push(`\`\`\`\n`);
      lines.push(testsOutput);
      lines.push(`\`\`\`\n`);
      lines.push(`\n## Implementation Instructions\n`);
      lines.push(`Implement the user story following Test-Driven Development (TDD) principles:`);
      lines.push(`1. Review the generated tests above`);
      lines.push(`2. Implement the code to make all tests pass`);
      lines.push(`3. Ensure code follows the project's architecture and coding standards`);
      lines.push(`4. Write clean, maintainable, and well-documented code`);
    } else {
      lines.push(`\nImplement this user story following the project's architecture and coding standards.`);
      lines.push(`Write clean, maintainable, and well-documented code.`);
    }

    return lines.join('\n');
  }

  /**
   * Start implementation phase after tests are generated
   */
  async startImplementationPhase(sessionId: string): Promise<void> {
    const session = await this.sessionRepo.findById(sessionId);
    if (!session) {
      throw new Error('Coding session not found');
    }

    if (session.status !== 'tests_generated') {
      throw new Error('Tests must be generated before starting implementation');
    }

    const story = await this.taskRepo.findById(session.story_id);
    if (!story) {
      throw new Error('Story not found');
    }

    // Create AI job for implementation
    const implementationPrompt = this.buildCodingPrompt(story, session.programmer_type, (session as any).tests_output);
    const implementationJob = await this.aiService.createAIJob({
      project_id: session.project_id,
      task_id: session.story_id,
      provider: 'cursor',
      mode: 'agent',
      prompt: implementationPrompt,
    });

    // Update session with implementation job ID
    const { Pool } = await import('pg');
    const pool = (await import('../config/database')).default;
    
    await this.sessionRepo.update(sessionId, {
      status: 'running',
      implementation_job_id: implementationJob.id,
      ai_job_id: implementationJob.id, // Keep for backward compatibility
    });

    // Update AI job args
    await pool.query(
      `UPDATE ai_jobs SET args = args || $1::jsonb WHERE id = $2`,
      [JSON.stringify({ coding_session_id: sessionId, phase: 'implementation' }), implementationJob.id]
    );
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
