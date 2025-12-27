import { AgentDBStateManager, TDDSessionState, HistoryEntry } from '../agentdb/AgentDBStateManager';

export { TDDSessionState, HistoryEntry };

export class TDDStateManager {
  private projectPath: string;
  private sessionId: string;
  private agentdbManager: AgentDBStateManager;

  constructor(projectPath: string, sessionId: string) {
    this.projectPath = projectPath;
    this.sessionId = sessionId;
    this.agentdbManager = new AgentDBStateManager(projectPath, sessionId);
  }

  /**
   * Save complete state to AgentDB
   */
  async saveState(state: TDDSessionState): Promise<void> {
    await this.agentdbManager.saveState(state);
  }

  /**
   * Load state from AgentDB
   */
  async loadState(): Promise<TDDSessionState | null> {
    return await this.agentdbManager.loadState();
  }

  /**
   * Append entry to history array
   */
  async appendHistory(entry: HistoryEntry): Promise<void> {
    await this.agentdbManager.appendHistory(entry);
  }

  /**
   * Update test status
   */
  async updateTestStatus(testIndex: number, status: 'pending' | 'passing' | 'failing'): Promise<void> {
    await this.agentdbManager.updateTestStatus(testIndex, status);
  }

  /**
   * Update current phase
   */
  async updatePhase(phase: 'green' | 'refactor'): Promise<void> {
    await this.agentdbManager.updatePhase(phase);
  }

  /**
   * Update implementation files list
   */
  async updateImplementationFiles(files: Array<{ path: string; last_modified: string }>): Promise<void> {
    await this.agentdbManager.updateImplementationFiles(files);
  }

  /**
   * Update batch information
   */
  async updateBatch(currentBatch: number, totalBatches: number): Promise<void> {
    await this.agentdbManager.updateBatch(currentBatch, totalBatches);
  }

  /**
   * Close AgentDB connection
   */
  async close(): Promise<void> {
    await this.agentdbManager.close();
  }
}

