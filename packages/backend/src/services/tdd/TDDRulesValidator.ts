import { AgentDBRulesManager, ValidationResult } from '../agentdb/AgentDBRulesManager';

export { ValidationResult };

export class TDDRulesValidator {
  private projectPath: string;
  private sessionId: string;
  private agentdbManager: AgentDBRulesManager;

  constructor(projectPath?: string, sessionId?: string) {
    this.projectPath = projectPath || '';
    this.sessionId = sessionId || '';
    if (projectPath && sessionId) {
      this.agentdbManager = new AgentDBRulesManager(projectPath, sessionId);
    } else {
      // Create a dummy manager for backward compatibility
      this.agentdbManager = new AgentDBRulesManager('', '');
    }
  }

  /**
   * Create rules in AgentDB instead of file-based storage
   */
  async createRulesFile(
    projectPath: string,
    sessionId: string,
    tests: Array<{ name: string; code: string }>,
    story: any
  ): Promise<void> {
    try {
      this.projectPath = projectPath;
      this.sessionId = sessionId;
      this.agentdbManager = new AgentDBRulesManager(projectPath, sessionId);
      
      await this.agentdbManager.createRules(sessionId, tests, story);
      console.log(`[TDD-RulesValidator] ✅ Created rules in AgentDB for session ${sessionId}`);
    } catch (error) {
      console.error('[TDD-RulesValidator] Error creating rules:', error);
      throw error;
    }
  }

  /**
   * Validate file changes against rules in AgentDB
   */
  async validateChanges(changedFiles: string[]): Promise<ValidationResult> {
    try {
      if (!this.agentdbManager) {
        return { valid: true, violations: [] }; // No manager, allow all
      }
      return await this.agentdbManager.validateChanges(changedFiles);
    } catch (error) {
      console.error('[TDD-RulesValidator] Error validating changes:', error);
      return { valid: false, violations: ['Error validating changes'] };
    }
  }

  /**
   * Get current rules object from AgentDB
   */
  async getRules(): Promise<any> {
    try {
      if (!this.agentdbManager) {
        return null;
      }
      return await this.agentdbManager.getRules();
    } catch (error: any) {
      console.error('[TDD-RulesValidator] Error reading rules:', error);
      return null;
    }
  }

  /**
   * Close AgentDB connection
   */
  async close(): Promise<void> {
    if (this.agentdbManager) {
      await this.agentdbManager.close();
    }
  }
}

