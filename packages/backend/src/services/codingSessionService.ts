import { CodingSessionRepository } from '../repositories/codingSessionRepository';
import { TaskRepository } from '../repositories/taskRepository';
import { AIService } from './aiService';
import { ProjectStructureService } from './projectStructureService';
import { ProjectRepository } from '../repositories/projectRepository';
import { 
  CodingSession, 
  CreateCodingSessionRequest, 
  StartImplementationRequest,
  ProgrammerType,
  ImplementationDashboard,
  TestStrategy
} from '@devflow-studio/shared';

// TDD Cycle interface for strict TDD implementation
interface TDDCycle {
  test_index: number;           // Current test being worked on (0-based)
  phase: 'red' | 'green' | 'refactor';  // Current phase in TDD cycle
  current_test: string;         // Current test code
  current_test_name: string;    // Name/description of current test
  tests_passed: number;         // Number of tests passing
  total_tests: number;          // Total tests to implement
  all_tests: Array<{            // All tests for this session
    name: string;
    code: string;
    status: 'pending' | 'red' | 'green' | 'refactored';
    attempts: number;
  }>;
  refactor_count: number;       // Number of refactors done
  stuck_count: number;          // Number of times stuck in GREEN phase
}

export class CodingSessionService {
  private sessionRepo: CodingSessionRepository;
  private taskRepo: TaskRepository;
  private aiService: AIService;
  private projectRepo: ProjectRepository;
  private structureService: ProjectStructureService;

  constructor() {
    this.sessionRepo = new CodingSessionRepository();
    this.taskRepo = new TaskRepository();
    this.aiService = new AIService();
    this.projectRepo = new ProjectRepository();
    this.structureService = new ProjectStructureService();
  }

  /**
   * Create a single coding session for a user story
   */
  async createSession(data: CreateCodingSessionRequest): Promise<CodingSession> {
    // Verify task exists (can be either 'story' or 'task' from breakdown)
    const story = await this.taskRepo.findById(data.story_id);
    if (!story) {
      throw new Error('Task not found');
    }

    // Allow both user stories and breakdown tasks
    if (story.type !== 'story' && story.type !== 'task') {
      throw new Error('Task must be a user story or a breakdown task');
    }

    // Check if session already exists for this story/task
    const existingSession = await this.sessionRepo.findByStoryId(data.story_id);
    if (existingSession && existingSession.status !== 'failed') {
      throw new Error(`Coding session already exists for this ${story.type === 'story' ? 'story' : 'task'}`);
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
      const testPrompt = await this.buildTestGenerationPrompt(story, data.programmer_type, data.project_id, true);
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

      // Update AI job args to include coding_session_id, test_strategy, and tdd_mode='strict' for strict TDD cycle
      await pool.query(
        `UPDATE ai_jobs SET args = args || $1::jsonb WHERE id = $2`,
        [JSON.stringify({ coding_session_id: session.id, phase: 'test_generation', test_strategy: 'tdd', tdd_mode: 'strict', unit_tests_only: true }), testJob.id]
      );
    } else if (testStrategy === 'after') {
      // 'after': Skip test generation, start implementation directly, generate tests after
      const implementationPrompt = await this.buildImplementationPrompt(story, data.programmer_type, data.project_id, undefined);
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
      const implementationPrompt = await this.buildImplementationPrompt(story, data.programmer_type, data.project_id, undefined);
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
   * RESPECTS breakdown_order and priority - implements in correct order
   */
  async startImplementation(data: StartImplementationRequest): Promise<CodingSession[]> {
    // Get project to create directory structure
    const project = await this.projectRepo.findById(data.project_id);
    if (project) {
      try {
        // Create recommended directory structure for the tech stack
        await this.structureService.createProjectStructure(project.base_path, project.tech_stack);
        console.log(`Created project structure for ${project.name} with tech stack: ${project.tech_stack || 'generic'}`);
      } catch (error: any) {
        console.error(`Failed to create project structure: ${error.message}`);
        // Don't fail the implementation if structure creation fails
      }
    }

    // Get all tasks and sort by breakdown_order (if available) and priority
    const tasks = await Promise.all(
      data.story_ids.map(id => this.taskRepo.findById(id))
    );
    
    // Filter out null tasks and sort by breakdown order and priority
    const validTasks = tasks
      .filter((task): task is NonNullable<typeof task> => task !== null)
      .sort((a, b) => {
        // First sort by breakdown_order if available (lower order = higher priority)
        const orderA = (a as any).breakdown_order ?? 9999;
        const orderB = (b as any).breakdown_order ?? 9999;
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        // Then sort by priority (higher priority = lower number for sorting, but we want higher first)
        return (b.priority || 0) - (a.priority || 0);
      });

    console.log(`[CodingSession] Starting implementation for ${validTasks.length} tasks in order:`);
    validTasks.forEach((task, index) => {
      const order = (task as any).breakdown_order ?? 'N/A';
      console.log(`  ${index + 1}. ${task.title} (breakdown_order: ${order}, priority: ${task.priority || 0})`);
    });

    const sessions: CodingSession[] = [];

    for (const task of validTasks) {
      // Auto-assign programmer type based on story context if enabled
      let programmerType: ProgrammerType = 'fullstack';
      if (data.auto_assign) {
        programmerType = this.detectProgrammerType(task);
      }

      try {
        const session = await this.createSession({
          project_id: data.project_id,
          story_id: task.id,
          programmer_type: programmerType,
          test_strategy: data.test_strategy || 'tdd',
        });
        sessions.push(session);
      } catch (error: any) {
        console.error(`Failed to create session for task ${task.id}:`, error.message);
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
  private async buildTestGenerationPrompt(story: any, programmerType: ProgrammerType, projectId: string, unitTestsOnly: boolean = true): Promise<string> {
    // Get full context from prompt bundle (includes PRD, RFC, Breakdown, Design, Stories)
    const promptBundle = await this.aiService.buildPromptBundle(projectId, story.id);
    
    const lines: string[] = [];

    lines.push(promptBundle);
    lines.push('\n---\n');
    lines.push(`# Test Generation Task: ${story.title}\n`);
    lines.push(`**Programmer Type**: ${programmerType}\n`);
    lines.push(`**Priority**: ${story.priority}\n\n`);
    lines.push(`**CRITICAL - SCOPE LIMITATION:**\n`);
    lines.push(`You MUST generate tests ONLY for the CURRENT TASK/STORY above: "${story.title}"\n`);
    lines.push(`- Do NOT generate tests for other user stories mentioned in the context\n`);
    lines.push(`- Do NOT generate tests for the entire project\n`);
    lines.push(`- Focus EXCLUSIVELY on this specific task/story and its acceptance criteria\n`);
    lines.push(`- The context above (PRD, RFC, other stories) is for REFERENCE ONLY to understand the project context\n`);
    lines.push(`- Your task is to test ONLY the functionality described in the CURRENT TASK/STORY section\n\n`);

    // Get related User Story and RFC if this is a breakdown task
    let relatedUserStory: any = null;
    let relatedRFC: any = null;
    
    if (story.type === 'task' && (story as any).epic_id) {
      // Get epic to find RFC
      const { EpicRepository } = await import('../repositories/epicRepository');
      const epicRepo = new EpicRepository();
      const epic = await epicRepo.findById((story as any).epic_id);
      
      if (epic && epic.rfc_id) {
        // Get RFC
        const { RFCGeneratorService } = await import('./rfcGeneratorService');
        const rfcService = new RFCGeneratorService();
        relatedRFC = await rfcService.getRFCById(epic.rfc_id);
      }
      
      // Try to find related user story through epic
      // Note: User stories don't have epic_id directly, but breakdown tasks do
      // We'll search for user stories in the same project that might be related
      const { Pool } = await import('pg');
      const pool = (await import('../config/database')).default;
      const storiesResult = await pool.query(
        `SELECT t.* FROM tasks t 
         WHERE t.project_id = $1 
         AND t.type = 'story'
         ORDER BY t.priority DESC
         LIMIT 1`,
        [projectId]
      );
      if (storiesResult.rows.length > 0) {
        relatedUserStory = storiesResult.rows[0];
      }
    } else if (story.type === 'story') {
      relatedUserStory = story;
    }

    // Add specific task details if it's a breakdown task
    if (story.type === 'task' && (story as any).epic_id) {
      lines.push(`## Breakdown Task Details\n`);
      lines.push(`**This is a breakdown task from the Epic & Breakdown section above.**\n`);
      lines.push(`**The task details below are extracted from the Breakdown specifications in the context above.**\n\n`);
      if ((story as any).breakdown_order) {
        lines.push(`**Order in Breakdown**: ${(story as any).breakdown_order}\n`);
      }
      if ((story as any).estimated_days) {
        lines.push(`**Estimated Days**: ${(story as any).estimated_days} (from breakdown estimation)\n`);
      }
      if ((story as any).story_points) {
        lines.push(`**Story Points**: ${(story as any).story_points} (from breakdown estimation)\n`);
      }
      
      // Add related User Story information
      if (relatedUserStory) {
        lines.push(`\n## Related User Story\n`);
        lines.push(`**Story**: ${relatedUserStory.title}\n`);
        if (relatedUserStory.description) {
          lines.push(`**Description**: ${relatedUserStory.description}\n`);
        }
        if (relatedUserStory.acceptance_criteria && Array.isArray(relatedUserStory.acceptance_criteria)) {
          lines.push(`**Acceptance Criteria**:\n`);
          relatedUserStory.acceptance_criteria.forEach((ac: any, idx: number) => {
            const acText = typeof ac === 'string' ? ac : (ac.criterion || ac);
            lines.push(`  ${idx + 1}. ${acText}\n`);
          });
        }
        lines.push(`\n**CRITICAL**: Tests MUST cover the acceptance criteria above from the related User Story.\n\n`);
      }
      
      // Add related RFC information
      if (relatedRFC) {
        lines.push(`## Related RFC (Technical Design)\n`);
        lines.push(`**RFC**: ${relatedRFC.title}\n`);
        lines.push(`\n**CRITICAL**: Tests MUST validate RFC specifications (API contracts, database schema, etc.).\n\n`);
      }
      
      lines.push(`\n**CRITICAL**: This task is part of a larger Epic. You MUST:\n`);
      lines.push(`- Reference the RFC (Technical Design) section above for API contracts, database schema, and architecture\n`);
      lines.push(`- Reference the Epic & Breakdown section above to understand dependencies and order\n`);
      lines.push(`- Reference User Flows & Design for UI/UX implementation\n`);
      lines.push(`- Follow the breakdown order and ensure compatibility with other tasks in the Epic\n`);
      if (relatedUserStory) {
        lines.push(`- Cover ALL acceptance criteria from the Related User Story above\n`);
      }
      lines.push(`\n`);
    }

    if (story.description) {
      lines.push(`## Task Description\n`);
      lines.push(`${story.description}\n\n`);
    }
    
    // Add acceptance criteria if available
    if (story.acceptance_criteria && Array.isArray(story.acceptance_criteria) && story.acceptance_criteria.length > 0) {
      lines.push(`## Acceptance Criteria\n`);
      story.acceptance_criteria.forEach((criteria: string, index: number) => {
        lines.push(`${index + 1}. ${criteria}\n`);
      });
      lines.push(`\n`);
    }

    // Get project info for structure
    const project = await this.projectRepo.findById(projectId);
    if (project) {
      const structure = this.structureService.getRecommendedStructure(project.tech_stack);
      lines.push(`## Project Structure\n`);
      lines.push(`This project uses a **monorepo structure** with apps/ and packages/ directories.\n`);
      lines.push(`${structure.description}\n\n`);
      lines.push(`**IMPORTANT: Save test files in the appropriate directory:**\n`);
      const testPath = this.structureService.getRecommendedPath('', 'test', project.tech_stack);
      lines.push(`- Unit tests: Save in \`${testPath}/unit/\` directory\n`);
      lines.push(`- Integration tests: Save in \`${testPath}/integration/\` directory (if generating integration tests)\n`);
      lines.push(`- E2E tests: Save in \`tests/e2e/\` directory (if generating e2e tests)\n`);
      lines.push(`- Follow the naming convention: \`*.test.js\` or \`*.spec.js\`\n\n`);
    }

    lines.push(`## Instructions\n`);
    lines.push(`You are a QA engineer. Your task is to generate test suites ONLY for the CURRENT TASK/STORY specified above.\n\n`);
    lines.push(`**CRITICAL - SCOPE RESTRICTION:**\n`);
    lines.push(`- Generate tests ONLY for: "${story.title}"\n`);
    lines.push(`- Do NOT generate tests for other user stories in the context\n`);
    lines.push(`- Do NOT generate tests for the entire project\n`);
    lines.push(`- Focus EXCLUSIVELY on the acceptance criteria of the CURRENT TASK/STORY\n`);
    lines.push(`- The PRD, RFC, and other stories are for REFERENCE ONLY to understand project context\n\n`);
    lines.push(`**Context Usage (Reference Only):**\n`);
    lines.push(`- Review the RFC (Technical Design) section for architecture and API contracts relevant to THIS task\n`);
    lines.push(`- Review the Breakdown section to understand THIS task's place in the larger Epic\n`);
    lines.push(`- Review User Flows & Design for UI/UX context relevant to THIS task\n`);
    lines.push(`- Ensure tests align with THIS task's acceptance criteria and technical specifications\n\n`);
    
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
    lines.push(`\n## Test Generation Guidelines\n`);
    lines.push(`Generate focused, runnable ${unitTestsOnly ? 'unit ' : ''}test suites that cover all acceptance criteria from the user story.\n`);
    lines.push(`**CRITICAL - TEST LIMITS:**\n`);
    lines.push(`- Generate **MAXIMUM 5-8 focused tests** (quality over quantity)\n`);
    lines.push(`- Cover ONLY the core acceptance criteria from THIS story\n`);
    lines.push(`- Each test must be essential - no redundant tests\n`);
    lines.push(`- Prioritize: Happy path (2 tests) + Critical edge cases (2-3 tests) + Error handling (2-3 tests)\n`);
    lines.push(`- Focus on the core functionality and acceptance criteria\n`);
    lines.push(`- Include edge cases and error handling, but be selective\n`);
    lines.push(`- Each test should have a clear, specific purpose\n`);
    lines.push(`- Avoid redundant tests that test the same behavior\n`);

    return lines.join('\n');
  }

  /**
   * Build implementation prompt (alias for buildCodingPrompt)
   */
  private async buildImplementationPrompt(story: any, programmerType: ProgrammerType, projectId: string, testsOutput?: string): Promise<string> {
    return this.buildCodingPrompt(story, programmerType, projectId, testsOutput);
  }

  /**
   * Build implementation prompt based on story, programmer type, and generated tests
   */
  private async buildCodingPrompt(story: any, programmerType: ProgrammerType, projectId: string, testsOutput?: string): Promise<string> {
    // Get full context from prompt bundle (includes PRD, RFC, Breakdown, Design, Stories)
    const promptBundle = await this.aiService.buildPromptBundle(projectId, story.id);
    
    const lines: string[] = [];

    lines.push(promptBundle);
    lines.push('\n---\n');
    lines.push(`# Coding Task: ${story.title}\n`);
    lines.push(`**Programmer Type**: ${programmerType}\n`);
    lines.push(`**Priority**: ${story.priority}\n\n`);

    // Get related User Story and RFC if this is a breakdown task
    let relatedUserStory: any = null;
    let relatedRFC: any = null;
    
    if (story.type === 'task' && (story as any).epic_id) {
      // Get epic to find RFC
      const { EpicRepository } = await import('../repositories/epicRepository');
      const epicRepo = new EpicRepository();
      const epic = await epicRepo.findById((story as any).epic_id);
      
      if (epic && epic.rfc_id) {
        // Get RFC
        const { RFCGeneratorService } = await import('./rfcGeneratorService');
        const rfcService = new RFCGeneratorService();
        relatedRFC = await rfcService.getRFCById(epic.rfc_id);
      }
      
      // Try to find related user story through epic or task description
      // Look for stories that might be related to this epic
      const { Pool } = await import('pg');
      const pool = (await import('../config/database')).default;
      const storiesResult = await pool.query(
        `SELECT t.* FROM tasks t 
         WHERE t.project_id = $1 
         AND t.type = 'story' 
         AND (t.epic_id = $2 OR t.id IN (
           SELECT id FROM tasks WHERE epic_id = $2
         ))
         ORDER BY t.priority DESC
         LIMIT 1`,
        [projectId, (story as any).epic_id]
      );
      if (storiesResult.rows.length > 0) {
        relatedUserStory = storiesResult.rows[0];
      }
    } else if (story.type === 'story') {
      // This is already a user story
      relatedUserStory = story;
    }

    // Add specific task details if it's a breakdown task
    if (story.type === 'task' && (story as any).epic_id) {
      lines.push(`## Breakdown Task Details\n`);
      lines.push(`**This is a breakdown task from the Epic & Breakdown section above.**\n`);
      lines.push(`**The task details below are extracted from the Breakdown specifications in the context above.**\n\n`);
      if ((story as any).breakdown_order) {
        lines.push(`**Order in Breakdown**: ${(story as any).breakdown_order}\n`);
      }
      if ((story as any).estimated_days) {
        lines.push(`**Estimated Days**: ${(story as any).estimated_days} (from breakdown estimation)\n`);
      }
      if ((story as any).story_points) {
        lines.push(`**Story Points**: ${(story as any).story_points} (from breakdown estimation)\n`);
      }
      
      // Add related User Story information
      if (relatedUserStory) {
        lines.push(`\n## Related User Story\n`);
        lines.push(`**Story**: ${relatedUserStory.title}\n`);
        if (relatedUserStory.description) {
          lines.push(`**Description**: ${relatedUserStory.description}\n`);
        }
        if (relatedUserStory.acceptance_criteria && Array.isArray(relatedUserStory.acceptance_criteria)) {
          lines.push(`**Acceptance Criteria**:\n`);
          relatedUserStory.acceptance_criteria.forEach((ac: any, idx: number) => {
            const acText = typeof ac === 'string' ? ac : (ac.criterion || ac);
            lines.push(`  ${idx + 1}. ${acText}\n`);
          });
        }
        lines.push(`\n**CRITICAL**: This breakdown task MUST fulfill the acceptance criteria above from the related User Story.\n\n`);
      }
      
      // Add related RFC information
      if (relatedRFC) {
        lines.push(`## Related RFC (Technical Design)\n`);
        lines.push(`**RFC**: ${relatedRFC.title}\n`);
        if (relatedRFC.status) {
          lines.push(`**Status**: ${relatedRFC.status}\n`);
        }
        lines.push(`\n**CRITICAL**: This implementation MUST follow the RFC specifications above. The complete RFC content is in the context section.\n\n`);
      }
      
      lines.push(`\n**CRITICAL - Implementation Requirements:**\n`);
      lines.push(`1. **Breakdown Order**: Implement according to breakdown order ${(story as any).breakdown_order || ''} and respect dependencies\n`);
      lines.push(`2. **User Story Compliance**: ${relatedUserStory ? 'Fulfill the acceptance criteria from the Related User Story above.' : 'Ensure alignment with related User Stories in the context above.'}\n`);
      lines.push(`3. **RFC Compliance**: ${relatedRFC ? 'Follow the Related RFC above EXACTLY.' : 'Follow the RFC (Technical Design) section in the context above EXACTLY.'}\n`);
      lines.push(`   - Use API contracts as specified in RFC\n`);
      lines.push(`   - Follow database schema from RFC\n`);
      lines.push(`   - Respect architecture patterns from RFC\n`);
      lines.push(`4. **Design Alignment**: Follow User Flows & Design section for UI/UX implementation\n`);
      lines.push(`5. **Priority**: This task has priority ${story.priority || 0} - implement accordingly\n\n`);
    } else if (story.type === 'story') {
      // This is a user story being implemented directly
      lines.push(`## User Story Implementation\n`);
      lines.push(`**This is a User Story being implemented directly.**\n\n`);
      
      // Try to find related RFC
      const { RFCGeneratorService } = await import('./rfcGeneratorService');
      const rfcService = new RFCGeneratorService();
      const rfcs = await rfcService.getRFCsByProject(projectId);
      if (rfcs && rfcs.length > 0) {
        const rfc = rfcs[0]; // Use first RFC
        relatedRFC = rfc;
        lines.push(`## Related RFC (Technical Design)\n`);
        lines.push(`**RFC**: ${rfc.title}\n`);
        lines.push(`\n**CRITICAL**: This implementation MUST follow the RFC specifications above. The complete RFC content is in the context section.\n\n`);
      }
    }

    if (story.description) {
      lines.push(`## Task Description\n`);
      lines.push(`${story.description}\n\n`);
    }
    
    // Add acceptance criteria if available
    if (story.acceptance_criteria && Array.isArray(story.acceptance_criteria) && story.acceptance_criteria.length > 0) {
      lines.push(`## Acceptance Criteria\n`);
      story.acceptance_criteria.forEach((criteria: string, index: number) => {
        lines.push(`${index + 1}. ${criteria}\n`);
      });
      lines.push(`\n`);
    }

    // Get project info for structure
    const project = await this.projectRepo.findById(projectId);
    if (project) {
      const structure = this.structureService.getRecommendedStructure(project.tech_stack);
      lines.push(`## Project Structure\n`);
      lines.push(`This project uses a **monorepo structure** with the following organization:\n`);
      lines.push(`- \`apps/\` - Deployable applications (shop-web, customer-app, admin-dashboard, api-gateway)\n`);
      lines.push(`- \`packages/\` - Shared libraries (ui-components, auth-logic, utils, database)\n`);
      lines.push(`- \`tools/\` - Automation scripts and generators\n`);
      lines.push(`- \`infra/\` - Infrastructure configuration (Terraform, Docker, Kubernetes)\n`);
      lines.push(`- \`docs/\` - Project documentation\n\n`);
      lines.push(`${structure.description}\n\n`);
      lines.push(`**IMPORTANT: Save files in the appropriate directories within the monorepo:**\n`);

      if (programmerType === 'backend' || programmerType === 'fullstack') {
        const backendPath = this.structureService.getRecommendedPath('', 'backend', project.tech_stack);
        lines.push(`- Backend code: Save in \`${backendPath}\` directory (typically \`apps/api-gateway/src/\`)\n`);
        lines.push(`  - Controllers/Routes: Place API endpoints in controllers/routes subdirectories\n`);
        lines.push(`  - Services: Place business logic in services subdirectories\n`);
        lines.push(`  - Models: Place data models in models subdirectories\n`);
        const dbPath = this.structureService.getRecommendedPath('', 'database', project.tech_stack);
        lines.push(`  - Database migrations: Save in \`${dbPath}/migrations/\` directory\n`);
        lines.push(`  - Shared utilities: Place in \`packages/utils/\` if reusable across apps\n`);
        lines.push(`  - Auth logic: Place in \`packages/auth-logic/\` if shared\n`);
      }

      if (programmerType === 'frontend' || programmerType === 'fullstack') {
        const frontendPath = this.structureService.getRecommendedPath('', 'frontend', project.tech_stack);
        lines.push(`- Frontend code: Save in \`${frontendPath}\` directory (typically \`apps/shop-web/src/\` or \`apps/admin-dashboard/src/\`)\n`);
        lines.push(`  - Components: Place React/Vue components in components subdirectories\n`);
        lines.push(`  - Pages: Place page components in pages subdirectories\n`);
        lines.push(`  - Services/Utils: Place API clients and utilities in services/utils subdirectories\n`);
        lines.push(`  - Shared UI components: Place reusable components in \`packages/ui-components/\`\n`);
      }
      
      lines.push(`- Documentation: Save in \`docs/\` directory\n`);
      
      lines.push(`- Configuration files: Save in \`config/\` directory\n`);
      lines.push(`- Documentation: Save in \`docs/\` directory\n\n`);
    }

    lines.push(`## Instructions\n`);
    lines.push(`**IMPORTANT - Reference Context Above:**\n`);
    lines.push(`- Follow the RFC (Technical Design) for architecture, API contracts, and database schema\n`);
    lines.push(`- Respect User Flows & Design for UI/UX implementation\n`);
    lines.push(`- Follow the Breakdown specifications and dependencies\n`);
    lines.push(`- Ensure alignment with all User Stories and their acceptance criteria\n`);
    lines.push(`- Maintain consistency with Architecture documentation\n\n`);
    
    if (programmerType === 'backend') {
      lines.push(`You are a backend developer. Focus on:`);
      lines.push(`- Implementing API endpoints and routes (as specified in RFC)\n`);
      lines.push(`- Database models and repositories (following RFC schema)\n`);
      lines.push(`- Business logic and services\n`);
      lines.push(`- Error handling and validation\n`);
      lines.push(`- Following REST/GraphQL best practices and RFC API contracts\n`);
    } else if (programmerType === 'frontend') {
      lines.push(`You are a frontend developer. Focus on:`);
      lines.push(`- Creating React components (following User Flows & Design)\n`);
      lines.push(`- Implementing UI/UX designs from the Design section\n`);
      lines.push(`- State management and API integration (using RFC API contracts)\n`);
      lines.push(`- Responsive design and accessibility\n`);
      lines.push(`- Following modern frontend best practices\n`);
    } else {
      lines.push(`You are a fullstack developer. Implement both:`);
      lines.push(`- Backend: API endpoints, services, and database operations (RFC-aligned)\n`);
      lines.push(`- Frontend: React components and UI implementation (Design-aligned)\n`);
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
      lines.push(`\nImplement this task following:`);
      lines.push(`- The RFC (Technical Design) specifications above`);
      lines.push(`- The Architecture documentation`);
      lines.push(`- User Flows & Design for UI components`);
      lines.push(`- Breakdown order and dependencies`);
      lines.push(`- Project's coding standards and best practices`);
      lines.push(`\nWrite clean, maintainable, and well-documented code that aligns with all context provided above.`);
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
    const implementationPrompt = await this.buildCodingPrompt(story, session.programmer_type, session.project_id, (session as any).tests_output);
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

  /**
   * Initialize TDD cycle after tests are generated
   * Starts directly with batch GREEN phase (no RED - tests will obviously fail before implementation)
   * Loads context bundle once and caches it for reuse
   */
  async initializeTDDCycle(sessionId: string, generatedTests: Array<{name: string; code: string}>): Promise<void> {
    const { Pool } = await import('pg');
    const pool = (await import('../config/database')).default;

    if (generatedTests.length === 0) {
      throw new Error('No tests generated for TDD cycle');
    }

    console.log(`[TDD] Initializing optimized TDD cycle for session ${sessionId} with ${generatedTests.length} tests`);

    const session = await this.sessionRepo.findById(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const story = await this.taskRepo.findById(session.story_id);
    if (!story) {
      throw new Error('Story not found');
    }

    // Load context bundle ONCE and cache it
    const contextBundle = await this.aiService.buildPromptBundle(session.project_id, story.id);

    // Initialize TDD cycle state with batch processing
    const batchSize = 3; // Process 3 tests per AI job
    const tddCycle: TDDCycle = {
      test_index: 0,
      phase: 'green' as const,  // Start directly with GREEN (no RED phase)
      batch_size: batchSize,
      current_batch_tests: generatedTests.slice(0, batchSize).map(t => t.name),
      tests_passed: 0,
      total_tests: generatedTests.length,
      all_tests: generatedTests.map(t => ({
        name: t.name,
        code: t.code,
        status: 'pending' as const,
        attempts: 0
      })),
      refactor_count: 0,
      stuck_count: 0,
      context_bundle: contextBundle
    };

    // Save TDD cycle state
    await pool.query(
      `UPDATE coding_sessions SET 
       status = $1, 
       tdd_cycle = $2::jsonb,
       test_progress = $3
       WHERE id = $4`,
      ['tdd_green', JSON.stringify(tddCycle), 0, sessionId]
    );

    console.log(`[TDD] Starting batch GREEN phase with ${tddCycle.current_batch_tests.length} tests`);

    // Start with batch GREEN phase: Implement code for first batch
    await this.executeBatchGREEN(sessionId, tddCycle);
  }

  /**
   * Batch GREEN Phase: Implement code to make multiple tests pass
   * Processes 3-5 tests in a single AI job for efficiency
   */
  async executeBatchGREEN(sessionId: string, tddCycle: TDDCycle): Promise<void> {
    const { Pool } = await import('pg');
    const pool = (await import('../config/database')).default;

    const batchStart = tddCycle.test_index;
    const batchEnd = Math.min(batchStart + tddCycle.batch_size, tddCycle.total_tests);
    const batchTests = tddCycle.all_tests.slice(batchStart, batchEnd);

    console.log(`[TDD-GREEN-BATCH] Implementing tests ${batchStart + 1}-${batchEnd}/${tddCycle.total_tests}`);

    const session = await this.sessionRepo.findById(sessionId);
    if (!session) throw new Error('Session not found');

    const story = await this.taskRepo.findById(session.story_id);
    if (!story) throw new Error('Story not found');

    // Mark batch tests as green
    for (let i = batchStart; i < batchEnd; i++) {
      tddCycle.all_tests[i].status = 'green';
      tddCycle.all_tests[i].attempts++;
    }

    // Update progress
    const progress = Math.floor((batchStart / tddCycle.total_tests) * 50);
    await pool.query(
      `UPDATE coding_sessions SET 
       status = $1, 
       tdd_cycle = $2::jsonb,
       implementation_progress = $3
       WHERE id = $4`,
      ['tdd_green', JSON.stringify(tddCycle), progress, sessionId]
    );

    // Build lightweight GREEN phase prompt (uses cached context)
    const greenPrompt = await this.buildBatchGREENPhasePrompt(session.project_id, story, batchTests, tddCycle);

    // Create AI job for batch GREEN phase
    const greenJob = await this.aiService.createAIJob({
      project_id: session.project_id,
      task_id: session.story_id,
      provider: 'cursor',
      mode: 'agent',
      prompt: greenPrompt,
    });

    await pool.query(
      `UPDATE ai_jobs SET args = args || $1::jsonb WHERE id = $2`,
      [JSON.stringify({ 
        coding_session_id: sessionId, 
        phase: 'tdd_green', 
        tdd_mode: 'strict',
        batch_size: batchTests.length,
        batch_start: batchStart
      }), greenJob.id]
    );

    console.log(`[TDD-GREEN-BATCH] Created AI job ${greenJob.id} for ${batchTests.length} tests`);
  }

  /**
   * Determine if refactoring should happen at this point
   * Strategic refactoring only at key milestones, not after every test
   */
  private shouldRefactor(tddCycle: TDDCycle): boolean {
    const progress = tddCycle.test_index / tddCycle.total_tests;
    
    // Refactor at strategic points:
    // 1. After 50% of tests (midpoint cleanup)
    // 2. After all tests complete (final refactor)
    // 3. If stuck multiple times (code quality issues)
    const atMidpoint = progress >= 0.5 && progress < 0.6 && tddCycle.refactor_count === 0;
    const atEnd = tddCycle.test_index >= tddCycle.total_tests;
    const isStuck = tddCycle.stuck_count > 2;
    
    return atMidpoint || atEnd || isStuck;
  }

  /**
   * REFACTOR Phase: Improve code while keeping tests passing
   */
  async executeRefactor(sessionId: string, tddCycle: TDDCycle): Promise<void> {
    const { Pool } = await import('pg');
    const pool = (await import('../config/database')).default;

    console.log(`[TDD-REFACTOR] Refactoring code after test ${tddCycle.test_index + 1}/${tddCycle.total_tests}`);

    const session = await this.sessionRepo.findById(sessionId);
    if (!session) throw new Error('Session not found');

    const story = await this.taskRepo.findById(session.story_id);
    if (!story) throw new Error('Story not found');

    // Update TDD cycle to REFACTOR phase
    tddCycle.phase = 'refactor';
    tddCycle.all_tests[tddCycle.test_index].status = 'refactored';
    tddCycle.refactor_count++;

    await pool.query(
      `UPDATE coding_sessions SET 
       status = $1, 
       tdd_cycle = $2::jsonb,
       progress = $3
       WHERE id = $4`,
      ['tdd_refactor', JSON.stringify(tddCycle),
       Math.floor(50 + (tddCycle.test_index / tddCycle.total_tests) * 30), // 50-80% range
       sessionId]
    );

    // Build REFACTOR phase prompt
    const refactorPrompt = await this.buildREFACTORPhasePrompt(session.project_id, story, tddCycle);

    // Create AI job for REFACTOR phase
    const refactorJob = await this.aiService.createAIJob({
      project_id: session.project_id,
      task_id: session.story_id,
      provider: 'cursor',
      mode: 'agent',
      prompt: refactorPrompt,
    });

    await pool.query(
      `UPDATE ai_jobs SET args = args || $1::jsonb WHERE id = $2`,
      [JSON.stringify({ 
        coding_session_id: sessionId, 
        phase: 'tdd_refactor',
        test_index: tddCycle.test_index,
        refactor_count: tddCycle.refactor_count
      }), refactorJob.id]
    );

    console.log(`[TDD-REFACTOR] Created REFACTOR phase job ${refactorJob.id} for session ${sessionId}`);
  }

  /**
   * Advance to next batch in TDD cycle
   * Implements strategic refactoring and batch processing
   */
  async advanceToNextBatch(sessionId: string): Promise<void> {
    const { Pool } = await import('pg');
    const pool = (await import('../config/database')).default;

    const result = await pool.query(
      'SELECT tdd_cycle FROM coding_sessions WHERE id = $1',
      [sessionId]
    );

    if (!result.rows[0] || !result.rows[0].tdd_cycle) {
      throw new Error('No TDD cycle found for session');
    }

    const tddCycle: TDDCycle = result.rows[0].tdd_cycle;

    // Move to next batch
    tddCycle.test_index += tddCycle.batch_size;
    tddCycle.tests_passed += tddCycle.batch_size;

    console.log(`[TDD] Batch completed. Progress: ${tddCycle.test_index}/${tddCycle.total_tests} tests`);

    // Check if should refactor strategically
    if (this.shouldRefactor(tddCycle)) {
      console.log(`[TDD] Strategic refactor triggered at ${Math.floor((tddCycle.test_index / tddCycle.total_tests) * 100)}% progress`);
      await this.executeRefactor(sessionId, tddCycle);
      return;
    }

    // Check if all tests completed
    if (tddCycle.test_index >= tddCycle.total_tests) {
      console.log(`[TDD] All ${tddCycle.total_tests} tests completed for session ${sessionId}. Marking as complete.`);
      
      await pool.query(
        `UPDATE coding_sessions SET 
         status = $1, 
         tdd_cycle = $2::jsonb,
         progress = $3,
         implementation_progress = $4,
         test_progress = $5,
         completed_at = NOW()
         WHERE id = $6`,
        ['completed', JSON.stringify(tddCycle), 100, 50, 50, sessionId]
      );

      return;
    }

    // Continue with next batch
    const batchStart = tddCycle.test_index;
    const batchEnd = Math.min(batchStart + tddCycle.batch_size, tddCycle.total_tests);
    tddCycle.current_batch_tests = tddCycle.all_tests.slice(batchStart, batchEnd).map(t => t.name);
    tddCycle.phase = 'green';

    await pool.query(
      `UPDATE coding_sessions SET 
       status = $1, 
       tdd_cycle = $2::jsonb
       WHERE id = $3`,
      ['tdd_green', JSON.stringify(tddCycle), sessionId]
    );

    console.log(`[TDD] Starting next batch: tests ${batchStart + 1}-${batchEnd}/${tddCycle.total_tests}`);

    // Start GREEN phase for next batch
    await this.executeBatchGREEN(sessionId, tddCycle);
  }

  /**
   * Build RED Phase prompt: Execute test and verify it FAILS
   */
  private async buildREDPhasePrompt(projectId: string, story: any, tddCycle: TDDCycle): Promise<string> {
    const lines: string[] = [];
    const project = await this.projectRepo.findById(projectId);
    
    lines.push(`# TDD RED PHASE: Verify Test Fails\n\n`);
    lines.push(`## Current Test (${tddCycle.test_index + 1}/${tddCycle.total_tests})\n\n`);
    lines.push(`**Test Name:** ${tddCycle.current_test_name}\n\n`);
    lines.push(`**Test Code:**\n`);
    lines.push(`\`\`\`\n${tddCycle.current_test}\n\`\`\`\n\n`);
    
    lines.push(`## RED Phase Objective\n\n`);
    lines.push(`**CRITICAL - RED Phase Requirements:**\n`);
    lines.push(`1. Save the test code to the appropriate test file\n`);
    lines.push(`2. Execute the test\n`);
    lines.push(`3. **The test MUST FAIL** (this validates the test is working)\n`);
    lines.push(`4. Verify the failure is because the feature is NOT implemented (not a syntax error)\n`);
    lines.push(`5. Report the test failure with clear error message\n\n`);
    
    if (project?.tech_stack) {
      lines.push(`## Tech Stack\n`);
      lines.push(`**Stack:** ${project.tech_stack}\n`);
      lines.push(`Use appropriate test runner for this stack.\n\n`);
    }
    
    lines.push(`## Instructions\n\n`);
    lines.push(`1. **Save Test:** Write the test code to the correct location in the project\n`);
    lines.push(`2. **Run Test:** Execute the test using the project's test runner\n`);
    lines.push(`3. **Verify Failure:** The test MUST fail. If it passes without implementation, the test is invalid.\n`);
    lines.push(`4. **Report:** Provide:\n`);
    lines.push(`   - Test file path\n`);
    lines.push(`   - Test execution command\n`);
    lines.push(`   - Test output showing FAILURE\n`);
    lines.push(`   - Reason for failure (should be "feature not implemented")\n\n`);
    
    lines.push(`## Expected Output\n\n`);
    lines.push(`\`\`\`json\n`);
    lines.push(`{\n`);
    lines.push(`  "phase": "red",\n`);
    lines.push(`  "test_file": "path/to/test.spec.js",\n`);
    lines.push(`  "test_failed": true,\n`);
    lines.push(`  "failure_reason": "Function 'calculateTotal' is not defined",\n`);
    lines.push(`  "test_output": "... test runner output ..."\n`);
    lines.push(`}\n`);
    lines.push(`\`\`\`\n\n`);
    
    lines.push(`**REMEMBER:** A failing test in RED phase is GOOD. It means the test is working correctly.\n`);
    
    return lines.join('');
  }

  /**
   * Build Batch GREEN Phase prompt (lightweight, uses cached context)
   * Implements multiple tests in a single AI job
   */
  private async buildBatchGREENPhasePrompt(
    projectId: string, 
    story: any, 
    batchTests: Array<{name: string; code: string; status: string; attempts: number}>, 
    tddCycle: TDDCycle
  ): Promise<string> {
    const lines: string[] = [];
    const project = await this.projectRepo.findById(projectId);
    
    lines.push(`# TDD GREEN PHASE: Implement Code for Test Batch\n\n`);
    
    // Use cached context if available, otherwise load it
    if (tddCycle.context_bundle) {
      lines.push(`## Project Context\n`);
      lines.push(`Refer to the project context (PRD, RFC, Breakdown, Design) provided at session start.\n\n`);
    } else {
      const promptBundle = await this.aiService.buildPromptBundle(projectId, story.id);
      lines.push(promptBundle);
      lines.push(`\n---\n\n`);
    }
    
    lines.push(`## Story: ${story.title}\n\n`);
    if (story.description) {
      lines.push(`**Description:** ${story.description}\n\n`);
    }
    
    const batchNum = Math.floor(tddCycle.test_index / tddCycle.batch_size) + 1;
    lines.push(`## Tests to Implement (Batch ${batchNum}/${Math.ceil(tddCycle.total_tests / tddCycle.batch_size)})\n\n`);
    lines.push(`Implement MINIMAL code to make ALL ${batchTests.length} tests pass:\n\n`);
    
    batchTests.forEach((test, i) => {
      lines.push(`### Test ${i + 1}: ${test.name}\n\n`);
      lines.push(`\`\`\`\n${test.code}\n\`\`\`\n\n`);
    });
    
    if (project?.tech_stack) {
      lines.push(`## Tech Stack\n`);
      lines.push(`**Stack:** ${project.tech_stack}\n`);
      lines.push(`Use ONLY technologies from this stack.\n\n`);
    }
    
    lines.push(`## GREEN Phase Objective\n\n`);
    lines.push(`**CRITICAL - GREEN Phase Requirements:**\n`);
    lines.push(`1. Write MINIMAL code to make ALL ${batchTests.length} tests pass\n`);
    lines.push(`2. Focus on making tests pass, NOT on perfect code (refactor comes later)\n`);
    lines.push(`3. Run tests after implementation to verify ALL pass\n`);
    lines.push(`4. If tests fail, fix the code until they pass\n`);
    lines.push(`5. Report success with test execution output\n\n`);
    
    // Show previous progress
    const passedTests = tddCycle.all_tests.slice(0, tddCycle.test_index).filter(t => t.status === 'green' || t.status === 'refactored');
    if (passedTests.length > 0) {
      lines.push(`## Previous Tests (Already Passing: ${passedTests.length})\n\n`);
      lines.push(`**IMPORTANT:** Your implementation must NOT break these existing tests.\n\n`);
    }
    
    lines.push(`## Instructions\n\n`);
    lines.push(`1. **Implement:** Write minimal code for all ${batchTests.length} tests\n`);
    lines.push(`2. **Run Tests:** Execute all tests in this batch\n`);
    lines.push(`3. **Verify:** All ${batchTests.length} tests MUST pass\n`);
    lines.push(`4. **Check Previous:** Run previous tests to ensure nothing broke\n`);
    lines.push(`5. **Report:** Provide test execution output showing all tests passing\n\n`);
    
    lines.push(`## Expected Output\n\n`);
    lines.push(`\`\`\`json\n`);
    lines.push(`{\n`);
    lines.push(`  "phase": "green",\n`);
    lines.push(`  "batch_size": ${batchTests.length},\n`);
    lines.push(`  "all_tests_passed": true,\n`);
    lines.push(`  "files_modified": ["path/to/file1.js", "path/to/file2.js"],\n`);
    lines.push(`  "test_output": "Test execution output showing all ${batchTests.length} tests passing"\n`);
    lines.push(`}\n`);
    lines.push(`\`\`\`\n`);
    
    return lines.join('');
  }

  /**
   * Build REFACTOR Phase prompt: Improve code while keeping tests passing
   */
  private async buildREFACTORPhasePrompt(projectId: string, story: any, tddCycle: TDDCycle): Promise<string> {
    const lines: string[] = [];
    const project = await this.projectRepo.findById(projectId);
    const promptBundle = await this.aiService.buildPromptBundle(projectId, story.id);
    
    lines.push(promptBundle);
    lines.push(`\n---\n\n`);
    
    lines.push(`# TDD REFACTOR PHASE: Improve Code Quality\n\n`);
    lines.push(`## Context\n\n`);
    lines.push(`**Tests Completed:** ${tddCycle.test_index + 1}/${tddCycle.total_tests}\n`);
    lines.push(`**Refactor Count:** ${tddCycle.refactor_count}\n\n`);
    
    lines.push(`## REFACTOR Phase Objective\n\n`);
    lines.push(`**CRITICAL - REFACTOR Phase Requirements:**\n`);
    lines.push(`1. Improve code quality without changing behavior\n`);
    lines.push(`2. ALL tests MUST continue to pass\n`);
    lines.push(`3. Apply clean code principles\n`);
    lines.push(`4. Remove duplication\n`);
    lines.push(`5. Improve names, structure, and readability\n\n`);
    
    if (project?.tech_stack) {
      lines.push(`## Tech Stack\n`);
      lines.push(`**Stack:** ${project.tech_stack}\n\n`);
    }
    
    lines.push(`## Refactoring Checklist\n\n`);
    lines.push(`Analyze the current code for these improvements:\n\n`);
    lines.push(`### Code Smells to Fix:\n`);
    lines.push(`- [ ] **Duplicated Code:** Extract to reusable functions\n`);
    lines.push(`- [ ] **Long Functions:** Break into smaller functions (< 20 lines)\n`);
    lines.push(`- [ ] **Magic Numbers:** Replace with named constants\n`);
    lines.push(`- [ ] **Poor Names:** Improve variable/function names for clarity\n`);
    lines.push(`- [ ] **Deep Nesting:** Flatten conditionals, use early returns\n`);
    lines.push(`- [ ] **Comments Explaining Code:** Refactor to self-documenting code\n`);
    lines.push(`- [ ] **Large Classes/Modules:** Split responsibilities (Single Responsibility Principle)\n\n`);
    
    lines.push(`### Design Improvements:\n`);
    lines.push(`- [ ] **Dependency Injection:** Inject dependencies instead of hardcoding\n`);
    lines.push(`- [ ] **Error Handling:** Add proper error handling if missing\n`);
    lines.push(`- [ ] **Type Safety:** Add types/interfaces if using TypeScript\n`);
    lines.push(`- [ ] **Immutability:** Prefer immutable data structures\n`);
    lines.push(`- [ ] **Pure Functions:** Minimize side effects\n\n`);
    
    lines.push(`## Refactoring Strategy\n\n`);
    lines.push(`1. **Small Steps:** Make one improvement at a time\n`);
    lines.push(`2. **Run Tests:** After EACH change, run ALL tests\n`);
    lines.push(`3. **Revert if Broken:** If any test fails, revert the change\n`);
    lines.push(`4. **Document:** Explain what you refactored and why\n\n`);
    
    lines.push(`## Tests That Must Pass\n\n`);
    const completedTests = tddCycle.all_tests.slice(0, tddCycle.test_index + 1);
    lines.push(`**All ${completedTests.length} tests must remain GREEN:**\n`);
    completedTests.forEach((t, i) => {
      lines.push(`${i + 1}. ✅ ${t.name}\n`);
    });
    lines.push(`\n`);
    
    lines.push(`## Instructions\n\n`);
    lines.push(`1. **Analyze:** Review current implementation for code smells\n`);
    lines.push(`2. **Plan:** Identify specific refactorings to apply\n`);
    lines.push(`3. **Refactor:** Apply improvements one at a time\n`);
    lines.push(`4. **Test:** Run ALL tests after each refactoring\n`);
    lines.push(`5. **Verify:** Ensure all ${completedTests.length} tests still pass\n`);
    lines.push(`6. **Document:** List refactorings applied\n\n`);
    
    lines.push(`## Expected Output\n\n`);
    lines.push(`\`\`\`json\n`);
    lines.push(`{\n`);
    lines.push(`  "phase": "refactor",\n`);
    lines.push(`  "refactorings_applied": [\n`);
    lines.push(`    "Extracted duplicate validation logic to validateInput() function",\n`);
    lines.push(`    "Renamed 'x' to 'totalAmount' for clarity",\n`);
    lines.push(`    "Flattened nested if statements using early returns"\n`);
    lines.push(`  ],\n`);
    lines.push(`  "files_modified": ["path/to/implementation.js"],\n`);
    lines.push(`  "all_tests_passed": true,\n`);
    lines.push(`  "test_output": "... all tests GREEN ..."\n`);
    lines.push(`}\n`);
    lines.push(`\`\`\`\n\n`);
    
    lines.push(`**REMEMBER:** Refactor means improving WITHOUT changing behavior. All tests must remain GREEN.\n`);
    
    return lines.join('');
  }
}
