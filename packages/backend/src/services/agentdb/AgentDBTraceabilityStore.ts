/**
 * AgentDB Traceability Store
 * 
 * Stores full traceability chain (PRD → Story → Design → RFC → Breakdown → Coding)
 * in AgentDB for each coding session to maintain context and prevent drift.
 */

import { AgentDBService, AgentDBInstance } from './AgentDBService';
import { TraceabilityService } from '../traceabilityService';

export interface TraceabilityChain {
  prd_id?: string;
  story_id: string;
  design_id?: string;
  user_flow_id?: string;
  rfc_id?: string;
  epic_id?: string;
  breakdown_tasks?: Array<{
    id: string;
    title: string;
    estimated_days?: number;
    story_points?: number;
  }>;
}

export class AgentDBTraceabilityStore {
  private agentdbService: AgentDBService;
  private instance: AgentDBInstance | null = null;
  private sessionId: string;
  private projectPath: string;
  private traceabilityService: TraceabilityService;

  constructor(projectPath: string, sessionId: string) {
    this.agentdbService = new AgentDBService();
    this.projectPath = projectPath;
    this.sessionId = sessionId;
    this.traceabilityService = new TraceabilityService();
  }

  /**
   * Ensure instance is established
   */
  private async ensureInstance(): Promise<AgentDBInstance> {
    if (!this.instance) {
      console.log(`[AgentDBTraceabilityStore] Getting AgentDB instance for project: ${this.projectPath}, session: ${this.sessionId}`);
      try {
        this.instance = await this.agentdbService.getInstance(this.projectPath, this.sessionId);
        console.log(`[AgentDBTraceabilityStore] ✅ AgentDB instance obtained successfully`);
      } catch (error: any) {
        console.error(`[AgentDBTraceabilityStore] ❌ Error getting AgentDB instance:`, error.message);
        console.error(`[AgentDBTraceabilityStore] Error stack:`, error.stack);
        throw error;
      }
    }
    return this.instance;
  }

  /**
   * Store full traceability chain for a story
   */
  async storeTraceabilityChain(storyId: string): Promise<void> {
    try {
      const instance = await this.ensureInstance();

      // Get full traceability chain from TraceabilityService
      const traceability = await this.traceabilityService.getStoryTraceability(storyId);

      // Build traceability chain object
      const chain: TraceabilityChain = {
        story_id: storyId,
        prd_id: traceability.prd?.id,
        rfc_id: traceability.rfc?.id,
        epic_id: traceability.epic?.id,
        breakdown_tasks: traceability.breakdownTasks?.map(task => ({
          id: task.id,
          title: task.title,
          estimated_days: (task as any).estimated_days,
          story_points: (task as any).story_points
        }))
      };

      // Get design/user flow IDs if available
      if (traceability.designs && traceability.designs.length > 0) {
        chain.design_id = traceability.designs[0].id;
        chain.user_flow_id = traceability.designs[0].id;
      }

      // Store in traceability table
      await this.agentdbService.executeStatement(
        instance,
        `INSERT OR REPLACE INTO traceability 
         (session_id, prd_id, story_id, design_id, rfc_id, epic_id, breakdown_tasks, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          this.sessionId,
          chain.prd_id || null,
          chain.story_id,
          chain.design_id || null,
          chain.rfc_id || null,
          chain.epic_id || null,
          JSON.stringify(chain.breakdown_tasks || [])
        ]
      );

      console.log(`[AgentDBTraceabilityStore] ✅ Stored traceability chain for story ${storyId}`);
    } catch (error) {
      console.error('[AgentDBTraceabilityStore] Error storing traceability chain:', error);
      throw error;
    }
  }

  /**
   * Get traceability chain from AgentDB
   */
  async getTraceabilityChain(): Promise<TraceabilityChain | null> {
    try {
      const instance = await this.ensureInstance();

      const result = await this.agentdbService.executeQuery(
        instance,
        `SELECT prd_id, story_id, design_id, rfc_id, epic_id, breakdown_tasks 
         FROM traceability WHERE session_id = ?`,
        [this.sessionId]
      );

      if (result && result.length > 0) {
        const row = result[0];
        return {
          prd_id: row.prd_id || undefined,
          story_id: row.story_id,
          design_id: row.design_id || undefined,
          user_flow_id: row.design_id || undefined,
          rfc_id: row.rfc_id || undefined,
          epic_id: row.epic_id || undefined,
          breakdown_tasks: row.breakdown_tasks ? JSON.parse(row.breakdown_tasks) : undefined
        };
      }

      return null;
    } catch (error) {
      console.error('[AgentDBTraceabilityStore] Error getting traceability chain:', error);
      return null;
    }
  }

  /**
   * Get traceability chain as formatted string for prompts
   */
  async getTraceabilityChainAsString(): Promise<string> {
    try {
      const chain = await this.getTraceabilityChain();
      
      if (!chain) {
        return '## Traceability Chain\n\nNo traceability information available.\n';
      }

      const lines: string[] = [];
      lines.push('## Traceability Chain\n');
      lines.push('This implementation is part of the following development flow:\n\n');

      if (chain.prd_id) {
        lines.push(`- **PRD ID**: ${chain.prd_id}`);
      }

      lines.push(`- **Story ID**: ${chain.story_id}`);

      if (chain.design_id) {
        lines.push(`- **Design/User Flow ID**: ${chain.design_id}`);
      }

      if (chain.rfc_id) {
        lines.push(`- **RFC ID**: ${chain.rfc_id}`);
      }

      if (chain.epic_id) {
        lines.push(`- **Epic ID**: ${chain.epic_id}`);
      }

      if (chain.breakdown_tasks && chain.breakdown_tasks.length > 0) {
        lines.push('\n### Breakdown Tasks:');
        chain.breakdown_tasks.forEach((task, index) => {
          lines.push(`  ${index + 1}. ${task.title} (ID: ${task.id})`);
          if (task.estimated_days) {
            lines.push(`     Estimated: ${task.estimated_days} days`);
          }
          if (task.story_points) {
            lines.push(`     Story Points: ${task.story_points}`);
          }
        });
      }

      lines.push('\n**IMPORTANT**: Maintain consistency with the above traceability chain. All implementation must align with the PRD, Design, and RFC specifications.\n');

      return lines.join('\n');
    } catch (error) {
      console.error('[AgentDBTraceabilityStore] Error formatting traceability chain:', error);
      return '## Traceability Chain\n\nError loading traceability information.\n';
    }
  }

  /**
   * Update traceability chain (e.g., when RFC is approved)
   */
  async updateTraceabilityChain(updates: Partial<TraceabilityChain>): Promise<void> {
    try {
      const instance = await this.ensureInstance();

      const current = await this.getTraceabilityChain();
      if (!current) {
        throw new Error('Cannot update: traceability chain not found');
      }

      const updated: TraceabilityChain = {
        ...current,
        ...updates
      };

      await this.agentdbService.executeStatement(
        instance,
        `UPDATE traceability SET 
         prd_id = ?, design_id = ?, rfc_id = ?, epic_id = ?, breakdown_tasks = ?, updated_at = CURRENT_TIMESTAMP
         WHERE session_id = ?`,
        [
          updated.prd_id || null,
          updated.design_id || null,
          updated.rfc_id || null,
          updated.epic_id || null,
          JSON.stringify(updated.breakdown_tasks || []),
          this.sessionId
        ]
      );

      console.log(`[AgentDBTraceabilityStore] ✅ Updated traceability chain for session ${this.sessionId}`);
    } catch (error) {
      console.error('[AgentDBTraceabilityStore] Error updating traceability chain:', error);
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
