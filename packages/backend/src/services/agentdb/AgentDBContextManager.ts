/**
 * AgentDB Context Manager
 * 
 * Manages TDD context using AgentDB instead of file-based storage.
 * Replaces TDDContextManager functionality with persistent database storage.
 */

import { AgentDBService, AgentDBInstance } from './AgentDBService';

export interface TDDContext {
  story: any;
  tests: Array<{ name: string; code: string }>;
  projectContext: string;
  constraints: string[];
  progress: Array<{ testIndex: number; phase: string; status: string }>;
  sessionLog: Array<{ timestamp: string; action: string; result: string }>;
}

export class AgentDBContextManager {
  private agentdbService: AgentDBService;
  private instance: AgentDBInstance | null = null;
  private sessionId: string;
  private projectPath: string;

  constructor(projectPath: string, sessionId: string) {
    this.agentdbService = new AgentDBService();
    this.projectPath = projectPath;
    this.sessionId = sessionId;
  }

  /**
   * Ensure instance is established
   */
  private async ensureInstance(): Promise<AgentDBInstance> {
    if (!this.instance) {
      console.log(`[AgentDBContextManager] Getting AgentDB instance for project: ${this.projectPath}, session: ${this.sessionId}`);
      try {
        this.instance = await this.agentdbService.getInstance(this.projectPath, this.sessionId);
        console.log(`[AgentDBContextManager] ✅ AgentDB instance obtained successfully`);
      } catch (error: any) {
        console.error(`[AgentDBContextManager] ❌ Error getting AgentDB instance:`, error.message);
        console.error(`[AgentDBContextManager] Error stack:`, error.stack);
        throw error;
      }
    }
    return this.instance;
  }

  /**
   * Initialize TDD context in AgentDB
   */
  async initializeTDDContext(
    story: any,
    tests: Array<{ name: string; code: string }>,
    projectContext: string
  ): Promise<void> {
    const instance = await this.ensureInstance();

    // Store tests
    for (let i = 0; i < tests.length; i++) {
      const test = tests[i];
      await this.agentdbService.executeStatement(
        instance,
        `INSERT INTO tests (session_id, story_id, name, code, status) 
         VALUES (?, ?, ?, ?, 'pending')`,
        [this.sessionId, story.id, test.name, test.code]
      );
    }

    // Store traceability (will be populated by AgentDBTraceabilityStore)
    await this.agentdbService.executeStatement(
      instance,
      `INSERT OR REPLACE INTO traceability (session_id, story_id, updated_at) 
       VALUES (?, ?, CURRENT_TIMESTAMP)`,
      [this.sessionId, story.id]
    );

    console.log(`[AgentDBContextManager] ✅ Initialized context for session ${this.sessionId}`);
  }

  /**
   * Get context from AgentDB
   */
  async getContext(): Promise<string> {
    const instance = await this.ensureInstance();

    // Get tests
    const tests = await this.agentdbService.executeQuery(
      instance,
      `SELECT name, code, status FROM tests WHERE session_id = ? ORDER BY id`,
      [this.sessionId]
    );

    // Get traceability
    const traceability = await this.agentdbService.executeQuery(
      instance,
      `SELECT * FROM traceability WHERE session_id = ?`,
      [this.sessionId]
    );

    // Get history
    const history = await this.agentdbService.executeQuery(
      instance,
      `SELECT * FROM history WHERE session_id = ? ORDER BY timestamp DESC LIMIT 20`,
      [this.sessionId]
    );

    // Build context string
    const lines: string[] = [];
    lines.push('# TDD Context');
    lines.push('');
    lines.push(`## Session: ${this.sessionId}`);
    lines.push('');

    // Handle traceability
    if (traceability && traceability.length > 0) {
      const trace = traceability[0];
      lines.push('## Traceability Chain');
      lines.push(`- PRD ID: ${trace.prd_id || 'N/A'}`);
      lines.push(`- Story ID: ${trace.story_id || 'N/A'}`);
      lines.push(`- Design ID: ${trace.design_id || 'N/A'}`);
      lines.push(`- RFC ID: ${trace.rfc_id || 'N/A'}`);
      lines.push(`- Epic ID: ${trace.epic_id || 'N/A'}`);
      lines.push('');
    }

    lines.push('## Tests');
    if (tests && tests.length > 0) {
      tests.forEach((test: any, index: number) => {
        lines.push(`### Test ${index + 1}: ${test.name}`);
        lines.push(`Status: ${test.status}`);
        lines.push('```javascript');
        lines.push(test.code);
        lines.push('```');
        lines.push('');
      });
    }

    if (history && history.length > 0) {
      lines.push('## Recent History');
      history.forEach((entry: any) => {
        lines.push(`- [${entry.timestamp}] ${entry.phase}: ${entry.action} - ${entry.result}`);
      });
    }

    return lines.join('\n');
  }

  /**
   * Update progress for a test
   */
  async updateProgress(testIndex: number, phase: string, status: string = 'in_progress'): Promise<void> {
    const instance = await this.ensureInstance();

    // Get test by index
    const tests = await this.agentdbService.executeQuery(
      instance,
      `SELECT id FROM tests WHERE session_id = ? ORDER BY id LIMIT 1 OFFSET ?`,
      [this.sessionId, testIndex]
    );

    if (tests && tests.length > 0) {
      const testId = tests[0].id;
      await this.agentdbService.executeStatement(
        instance,
        `UPDATE tests SET status = ? WHERE id = ?`,
        [status, testId]
      );
    }

    // Add history entry
    await this.agentdbService.executeStatement(
      instance,
      `INSERT INTO history (session_id, phase, action, result) 
       VALUES (?, ?, ?, ?)`,
      [this.sessionId, phase, `Test ${testIndex + 1} progress`, status]
    );
  }

  /**
   * Mark test as complete
   */
  async markTestComplete(testIndex: number): Promise<void> {
    await this.updateProgress(testIndex, 'green', 'passing');
  }

  /**
   * Add decision to context
   */
  async addDecision(
    action: string,
    reason: string,
    codeSnippet?: string,
    testRelated?: string
  ): Promise<void> {
    const instance = await this.ensureInstance();

    await this.agentdbService.executeStatement(
      instance,
      `INSERT INTO decisions (session_id, action, reason, code_snippet, test_related) 
       VALUES (?, ?, ?, ?, ?)`,
      [this.sessionId, action, reason, codeSnippet || null, testRelated || null]
    );
  }

  /**
   * Search for related code/decisions using semantic search
   * Note: This requires vector embeddings support in AgentDB
   */
  async searchRelated(query: string, limit: number = 5): Promise<Array<{ type: string; content: string; relevance: number }>> {
    const instance = await this.ensureInstance();

    // Basic text search (semantic search requires vector embeddings)
    const decisions = await this.agentdbService.executeQuery(
      instance,
      `SELECT action, reason, code_snippet FROM decisions 
       WHERE session_id = ? AND (action LIKE ? OR reason LIKE ?)
       ORDER BY timestamp DESC LIMIT ?`,
      [this.sessionId, `%${query}%`, `%${query}%`, limit]
    );

    const results: Array<{ type: string; content: string; relevance: number }> = [];

    if (decisions && decisions.length > 0) {
      decisions.forEach((row: any) => {
        results.push({
          type: 'decision',
          content: `${row.action}: ${row.reason}`,
          relevance: 0.8 // Placeholder - would use vector similarity in real implementation
        });
      });
    }

    return results;
  }

  /**
   * Close connection
   */
  async close(): Promise<void> {
    if (this.instance) {
      this.instance.close();
      this.instance = null;
    }
  }
}
