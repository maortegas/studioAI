import { Pool } from 'pg';
import pool from '../config/database';
import { CodingSession, CodingSessionStatus, ProgrammerType, CodingSessionEvent } from '@devflow-studio/shared';

export class CodingSessionRepository {
  private pool: Pool;

  constructor() {
    this.pool = pool;
  }

  async create(data: {
    project_id: string;
    story_id: string;
    programmer_type: ProgrammerType;
    ai_job_id?: string;
  }): Promise<CodingSession> {
    const result = await this.pool.query(
      `INSERT INTO coding_sessions (project_id, story_id, programmer_type, ai_job_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.project_id, data.story_id, data.programmer_type, data.ai_job_id]
    );
    return result.rows[0];
  }

  async findById(id: string): Promise<CodingSession | null> {
    const result = await this.pool.query(
      'SELECT * FROM coding_sessions WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  async findByProjectId(projectId: string): Promise<CodingSession[]> {
    const result = await this.pool.query(
      'SELECT * FROM coding_sessions WHERE project_id = $1 ORDER BY created_at DESC',
      [projectId]
    );
    return result.rows;
  }

  async findByStoryId(storyId: string): Promise<CodingSession | null> {
    const result = await this.pool.query(
      'SELECT * FROM coding_sessions WHERE story_id = $1 ORDER BY created_at DESC LIMIT 1',
      [storyId]
    );
    return result.rows[0] || null;
  }

  async findByStatus(projectId: string, status: CodingSessionStatus): Promise<CodingSession[]> {
    const result = await this.pool.query(
      'SELECT * FROM coding_sessions WHERE project_id = $1 AND status = $2 ORDER BY created_at DESC',
      [projectId, status]
    );
    return result.rows;
  }

  async update(id: string, data: Partial<CodingSession>): Promise<CodingSession> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (data.status !== undefined) {
      fields.push(`status = $${paramCount++}`);
      values.push(data.status);
    }
    if (data.progress !== undefined) {
      fields.push(`progress = $${paramCount++}`);
      values.push(data.progress);
    }
    if (data.current_file !== undefined) {
      fields.push(`current_file = $${paramCount++}`);
      values.push(data.current_file);
    }
    if (data.output !== undefined) {
      fields.push(`output = $${paramCount++}`);
      values.push(data.output);
    }
    if (data.error !== undefined) {
      fields.push(`error = $${paramCount++}`);
      values.push(data.error);
    }
    if (data.started_at !== undefined) {
      fields.push(`started_at = $${paramCount++}`);
      values.push(data.started_at);
    }
    if (data.completed_at !== undefined) {
      fields.push(`completed_at = $${paramCount++}`);
      values.push(data.completed_at);
    }
    if (data.ai_job_id !== undefined) {
      fields.push(`ai_job_id = $${paramCount++}`);
      values.push(data.ai_job_id);
    }

    values.push(id);

    const result = await this.pool.query(
      `UPDATE coding_sessions SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );
    return result.rows[0];
  }

  async delete(id: string): Promise<void> {
    await this.pool.query('DELETE FROM coding_sessions WHERE id = $1', [id]);
  }

  // Event methods
  async addEvent(sessionId: string, eventType: string, payload: any): Promise<void> {
    await this.pool.query(
      `INSERT INTO coding_session_events (session_id, event_type, payload)
       VALUES ($1, $2, $3)`,
      [sessionId, eventType, JSON.stringify(payload)]
    );
  }

  async getEvents(sessionId: string, limit: number = 100): Promise<CodingSessionEvent[]> {
    const result = await this.pool.query(
      `SELECT session_id, event_type, payload, created_at as timestamp
       FROM coding_session_events
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [sessionId, limit]
    );
    return result.rows.map(row => ({
      ...row,
      payload: row.payload,
    }));
  }

  async getRecentEvents(sessionId: string, since: Date): Promise<CodingSessionEvent[]> {
    const result = await this.pool.query(
      `SELECT session_id, event_type, payload, created_at as timestamp
       FROM coding_session_events
       WHERE session_id = $1 AND created_at > $2
       ORDER BY created_at ASC`,
      [sessionId, since]
    );
    return result.rows.map(row => ({
      ...row,
      payload: row.payload,
    }));
  }

  async getDashboard(projectId: string) {
    const sessions = await this.findByProjectId(projectId);
    
    const stats = await this.pool.query(
      `SELECT 
        COUNT(*) as total_stories,
        SUM(CASE WHEN cs.status = 'completed' THEN 1 ELSE 0 END) as completed_stories,
        SUM(CASE WHEN cs.status = 'running' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN cs.status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN cs.status = 'failed' THEN 1 ELSE 0 END) as failed
       FROM coding_sessions cs
       WHERE cs.project_id = $1`,
      [projectId]
    );

    return {
      project_id: projectId,
      sessions,
      total_stories: parseInt(stats.rows[0].total_stories || '0'),
      completed_stories: parseInt(stats.rows[0].completed_stories || '0'),
      in_progress: parseInt(stats.rows[0].in_progress || '0'),
      pending: parseInt(stats.rows[0].pending || '0'),
      failed: parseInt(stats.rows[0].failed || '0'),
    };
  }
}
