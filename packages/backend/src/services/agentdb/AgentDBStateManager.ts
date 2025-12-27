/**
 * AgentDB State Manager
 * 
 * Manages TDD session state using AgentDB instead of file-based JSON storage.
 * Replaces TDDStateManager functionality with persistent database storage.
 */

import { AgentDBService, AgentDBInstance } from './AgentDBService';

export interface TDDSessionState {
  session_id: string;
  story: any;
  tests: Array<{
    name: string;
    code: string;
    status: 'pending' | 'passing' | 'failing';
  }>;
  implementation_files: Array<{
    path: string;
    last_modified: string;
  }>;
  current_phase: 'green' | 'refactor';
  current_batch: number;
  total_batches: number;
  history: Array<{
    timestamp: string;
    phase: string;
    action: string;
    result: 'success' | 'failure';
    files_modified: string[];
  }>;
}

export interface HistoryEntry {
  timestamp: string;
  phase: string;
  action: string;
  result: 'success' | 'failure';
  files_modified: string[];
}

export class AgentDBStateManager {
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
      console.log(`[AgentDBStateManager] Getting AgentDB instance for project: ${this.projectPath}, session: ${this.sessionId}`);
      try {
        this.instance = await this.agentdbService.getInstance(this.projectPath, this.sessionId);
        console.log(`[AgentDBStateManager] ✅ AgentDB instance obtained successfully`);
      } catch (error: any) {
        console.error(`[AgentDBStateManager] ❌ Error getting AgentDB instance:`, error.message);
        console.error(`[AgentDBStateManager] Error stack:`, error.stack);
        throw error;
      }
    }
    return this.instance;
  }

  /**
   * Save complete state to AgentDB
   */
  async saveState(state: TDDSessionState): Promise<void> {
    try {
      const instance = await this.ensureInstance();

      // Store state as JSON in tdd_state table
      await this.agentdbService.executeStatement(
        instance,
        `INSERT OR REPLACE INTO tdd_state (session_id, state_json, updated_at) 
         VALUES (?, ?, CURRENT_TIMESTAMP)`,
        [this.sessionId, JSON.stringify(state)]
      );

      // Also store individual test statuses in tests table
      for (let i = 0; i < state.tests.length; i++) {
        const test = state.tests[i];
        await this.agentdbService.executeStatement(
          instance,
          `UPDATE tests SET status = ? WHERE session_id = ? AND name = ?`,
          [test.status, this.sessionId, test.name]
        );
      }

      // Store history entries
      for (const entry of state.history) {
        await this.agentdbService.executeStatement(
          instance,
          `INSERT INTO history (session_id, phase, action, result, files_modified, timestamp) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            this.sessionId,
            entry.phase,
            entry.action,
            entry.result,
            JSON.stringify(entry.files_modified),
            entry.timestamp
          ]
        );
      }

      console.log(`[AgentDBStateManager] ✅ Saved state for session ${this.sessionId}`);
    } catch (error) {
      console.error('[AgentDBStateManager] Error saving state:', error);
      throw error;
    }
  }

  /**
   * Load state from AgentDB
   */
  async loadState(): Promise<TDDSessionState | null> {
    try {
      const instance = await this.ensureInstance();

      const result = await this.agentdbService.executeQuery(
        instance,
        `SELECT state_json FROM tdd_state WHERE session_id = ?`,
        [this.sessionId]
      );

      if (result && result.length > 0) {
        const stateJson = result[0].state_json;
        return JSON.parse(stateJson) as TDDSessionState;
      }

      return null;
    } catch (error: any) {
      console.error('[AgentDBStateManager] Error loading state:', error);
      return null;
    }
  }

  /**
   * Append entry to history array
   */
  async appendHistory(entry: HistoryEntry): Promise<void> {
    try {
      const instance = await this.ensureInstance();

      // Add to history table
      await this.agentdbService.executeStatement(
        instance,
        `INSERT INTO history (session_id, phase, action, result, files_modified, timestamp) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          this.sessionId,
          entry.phase,
          entry.action,
          entry.result,
          JSON.stringify(entry.files_modified),
          entry.timestamp
        ]
      );

      // Update state JSON
      const state = await this.loadState();
      if (state) {
        state.history.push(entry);
        await this.saveState(state);
      }

      console.log(`[AgentDBStateManager] Appended history entry: ${entry.action}`);
    } catch (error) {
      console.error('[AgentDBStateManager] Error appending history:', error);
      throw error;
    }
  }

  /**
   * Update test status
   */
  async updateTestStatus(testIndex: number, status: 'pending' | 'passing' | 'failing'): Promise<void> {
    try {
      const instance = await this.ensureInstance();

      // Get test by index
      const tests = await this.agentdbService.executeQuery(
        instance,
        `SELECT id, name FROM tests WHERE session_id = ? ORDER BY id LIMIT 1 OFFSET ?`,
        [this.sessionId, testIndex]
      );

      if (tests && tests.length > 0) {
        const testName = tests[0].name;
        
        // Update in tests table
        await this.agentdbService.executeStatement(
          instance,
          `UPDATE tests SET status = ? WHERE session_id = ? AND name = ?`,
          [status, this.sessionId, testName]
        );

        // Update in state JSON
        const state = await this.loadState();
        if (state && state.tests[testIndex]) {
          state.tests[testIndex].status = status;
          await this.saveState(state);
        }

        console.log(`[AgentDBStateManager] Updated test ${testIndex + 1} status to ${status}`);
      }
    } catch (error) {
      console.error('[AgentDBStateManager] Error updating test status:', error);
      throw error;
    }
  }

  /**
   * Update current phase
   */
  async updatePhase(phase: 'green' | 'refactor'): Promise<void> {
    try {
      const state = await this.loadState();
      if (!state) {
        throw new Error('Cannot update phase: state not initialized');
      }

      state.current_phase = phase;
      await this.saveState(state);
      console.log(`[AgentDBStateManager] Updated phase to ${phase}`);
    } catch (error) {
      console.error('[AgentDBStateManager] Error updating phase:', error);
      throw error;
    }
  }

  /**
   * Update implementation files list
   */
  async updateImplementationFiles(files: Array<{ path: string; last_modified: string }>): Promise<void> {
    try {
      const state = await this.loadState();
      if (!state) {
        throw new Error('Cannot update implementation files: state not initialized');
      }

      state.implementation_files = files;
      await this.saveState(state);
      console.log(`[AgentDBStateManager] Updated implementation files: ${files.length} files`);
    } catch (error) {
      console.error('[AgentDBStateManager] Error updating implementation files:', error);
      throw error;
    }
  }

  /**
   * Update batch information
   */
  async updateBatch(currentBatch: number, totalBatches: number): Promise<void> {
    try {
      const state = await this.loadState();
      if (!state) {
        throw new Error('Cannot update batch: state not initialized');
      }

      state.current_batch = currentBatch;
      state.total_batches = totalBatches;
      await this.saveState(state);
      console.log(`[AgentDBStateManager] Updated batch: ${currentBatch}/${totalBatches}`);
    } catch (error) {
      console.error('[AgentDBStateManager] Error updating batch:', error);
      throw error;
    }
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
