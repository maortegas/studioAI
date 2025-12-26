import { AgentDBContextManager } from '../agentdb/AgentDBContextManager';

export class TDDContextManager {
  private projectPath: string;
  private sessionId: string;
  private agentdbManager: AgentDBContextManager;

  constructor(projectPath: string, sessionId: string) {
    this.projectPath = projectPath;
    this.sessionId = sessionId;
    this.agentdbManager = new AgentDBContextManager(projectPath, sessionId);
  }

  /**
   * Initialize TDD context using AgentDB instead of file-based storage
   */
  async initializeTDDContext(
    story: any,
    tests: Array<{ name: string; code: string }>,
    projectContext: string
  ): Promise<void> {
    try {
      // Use AgentDB to store context
      await this.agentdbManager.initializeTDDContext(story, tests, projectContext);
      console.log(`[TDD-ContextManager] ✅ Initialized context in AgentDB for session ${this.sessionId}`);
    } catch (error) {
      console.error('[TDD-ContextManager] Error initializing context:', error);
      throw error;
    }
  }

  /**
   * Get current context from AgentDB
   */
  async getContext(): Promise<string> {
    try {
      return await this.agentdbManager.getContext();
    } catch (error) {
      console.error('[TDD-ContextManager] Error getting context:', error);
      return '';
    }
  }

  /**
   * Update progress in AgentDB
   */
  async updateProgress(testIndex: number, phase: string): Promise<void> {
    try {
      await this.agentdbManager.updateProgress(testIndex, phase);
      console.log(`[TDD-ContextManager] Updated progress for test ${testIndex + 1}`);
    } catch (error) {
      console.error('[TDD-ContextManager] Error updating progress:', error);
      throw error;
    }
  }

  /**
   * Mark test as complete in AgentDB
   */
  async markTestComplete(testIndex: number): Promise<void> {
    await this.agentdbManager.markTestComplete(testIndex);
  }

  /**
   * Close AgentDB connection
   */
  async close(): Promise<void> {
    await this.agentdbManager.close();
  }
}

