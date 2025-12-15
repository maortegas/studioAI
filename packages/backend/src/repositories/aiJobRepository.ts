import pool from '../config/database';
import { AIJob, AIJobEvent, AIJobStatus } from '@devflow-studio/shared';

export class AIJobRepository {
  async findById(id: string): Promise<AIJob | null> {
    const result = await pool.query('SELECT * FROM ai_jobs WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  async findByProjectId(projectId: string): Promise<AIJob[]> {
    const result = await pool.query(
      'SELECT * FROM ai_jobs WHERE project_id = $1 ORDER BY created_at DESC',
      [projectId]
    );
    return result.rows;
  }

  async create(job: Omit<AIJob, 'id' | 'created_at'>): Promise<AIJob> {
    const result = await pool.query(
      `INSERT INTO ai_jobs (project_id, task_id, provider, command, args, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        job.project_id,
        job.task_id || null,
        job.provider,
        job.command,
        JSON.stringify(job.args || {}),
        job.status,
      ]
    );
    return result.rows[0];
  }

  async updateStatus(id: string, status: AIJobStatus, startedAt?: Date, finishedAt?: Date): Promise<AIJob | null> {
    const updates: string[] = [`status = $1`];
    const values: any[] = [status];
    let paramCount = 2;

    if (startedAt) {
      updates.push(`started_at = $${paramCount++}`);
      values.push(startedAt);
    }
    if (finishedAt) {
      updates.push(`finished_at = $${paramCount++}`);
      values.push(finishedAt);
    }

    values.push(id);

    const result = await pool.query(
      `UPDATE ai_jobs SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );
    return result.rows[0] || null;
  }

  async addEvent(event: Omit<AIJobEvent, 'id' | 'created_at'>): Promise<AIJobEvent> {
    const result = await pool.query(
      `INSERT INTO ai_job_events (job_id, event_type, payload)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [event.job_id, event.event_type, JSON.stringify(event.payload || {})]
    );
    return result.rows[0];
  }

  async getEvents(jobId: string): Promise<AIJobEvent[]> {
    const result = await pool.query(
      'SELECT * FROM ai_job_events WHERE job_id = $1 ORDER BY created_at ASC',
      [jobId]
    );
    return result.rows;
  }
}

