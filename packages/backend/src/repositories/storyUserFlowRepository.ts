import pool from '../config/database';

export interface StoryUserFlow {
  id: string;
  story_id: string;
  user_flow_id: string;
  created_at: Date;
}

export class StoryUserFlowRepository {
  /**
   * Create a relationship between a story and a user flow
   */
  async create(storyId: string, userFlowId: string): Promise<StoryUserFlow> {
    const result = await pool.query(
      `INSERT INTO story_user_flows (story_id, user_flow_id)
       VALUES ($1, $2)
       ON CONFLICT (story_id, user_flow_id) DO NOTHING
       RETURNING *`,
      [storyId, userFlowId]
    );

    if (result.rows.length === 0) {
      // Relationship already exists, fetch it
      const existing = await pool.query(
        `SELECT * FROM story_user_flows WHERE story_id = $1 AND user_flow_id = $2`,
        [storyId, userFlowId]
      );
      return this.mapRowToStoryUserFlow(existing.rows[0]);
    }

    return this.mapRowToStoryUserFlow(result.rows[0]);
  }

  /**
   * Get all user flows for a story
   */
  async findByStoryId(storyId: string): Promise<StoryUserFlow[]> {
    const result = await pool.query(
      `SELECT * FROM story_user_flows WHERE story_id = $1 ORDER BY created_at`,
      [storyId]
    );
    return result.rows.map(row => this.mapRowToStoryUserFlow(row));
  }

  /**
   * Get all stories for a user flow
   */
  async findByUserFlowId(userFlowId: string): Promise<StoryUserFlow[]> {
    const result = await pool.query(
      `SELECT * FROM story_user_flows WHERE user_flow_id = $1 ORDER BY created_at`,
      [userFlowId]
    );
    return result.rows.map(row => this.mapRowToStoryUserFlow(row));
  }

  /**
   * Delete a relationship
   */
  async delete(storyId: string, userFlowId: string): Promise<void> {
    await pool.query(
      `DELETE FROM story_user_flows WHERE story_id = $1 AND user_flow_id = $2`,
      [storyId, userFlowId]
    );
  }

  /**
   * Delete all relationships for a story
   */
  async deleteByStoryId(storyId: string): Promise<void> {
    await pool.query(
      `DELETE FROM story_user_flows WHERE story_id = $1`,
      [storyId]
    );
  }

  /**
   * Delete all relationships for a user flow
   */
  async deleteByUserFlowId(userFlowId: string): Promise<void> {
    await pool.query(
      `DELETE FROM story_user_flows WHERE user_flow_id = $1`,
      [userFlowId]
    );
  }

  private mapRowToStoryUserFlow(row: any): StoryUserFlow {
    return {
      id: row.id,
      story_id: row.story_id,
      user_flow_id: row.user_flow_id,
      created_at: row.created_at,
    };
  }
}

