import pool from '../config/database';
import { Epic, CreateEpicRequest, UpdateEpicRequest } from '@devflow-studio/shared';

export class EpicRepository {
  async findByProjectId(projectId: string): Promise<Epic[]> {
    const result = await pool.query(
      'SELECT * FROM epics WHERE project_id = $1 ORDER BY order_index ASC, created_at DESC',
      [projectId]
    );
    return result.rows.map((row: any) => this.mapRowToEpic(row));
  }

  async findByRFCId(rfcId: string): Promise<Epic[]> {
    const result = await pool.query(
      'SELECT * FROM epics WHERE rfc_id = $1 ORDER BY order_index ASC, created_at DESC',
      [rfcId]
    );
    return result.rows.map((row: any) => this.mapRowToEpic(row));
  }

  async findById(id: string): Promise<Epic | null> {
    const result = await pool.query(
      'SELECT * FROM epics WHERE id = $1',
      [id]
    );
    return result.rows[0] ? this.mapRowToEpic(result.rows[0]) : null;
  }

  async create(data: CreateEpicRequest): Promise<Epic> {
    // Validate project exists
    const projectCheck = await pool.query(
      'SELECT id FROM projects WHERE id = $1',
      [data.project_id]
    );
    if (projectCheck.rows.length === 0) {
      throw new Error(`Project ${data.project_id} not found`);
    }

    // Validate RFC exists and belongs to project if provided
    if (data.rfc_id) {
      const rfcCheck = await pool.query(
        'SELECT id, project_id FROM rfc_documents WHERE id = $1',
        [data.rfc_id]
      );
      if (rfcCheck.rows.length === 0) {
        throw new Error(`RFC ${data.rfc_id} not found`);
      }
      if (rfcCheck.rows[0].project_id !== data.project_id) {
        throw new Error(`RFC ${data.rfc_id} does not belong to project ${data.project_id}`);
      }
    }

    const result = await pool.query(
      `INSERT INTO epics (project_id, rfc_id, title, description, order_index, status)
       VALUES ($1, $2, $3, $4, $5, 'planned')
       RETURNING *`,
      [
        data.project_id,
        data.rfc_id || null,
        data.title,
        data.description || null,
        data.order_index || null,
      ]
    );
    return this.mapRowToEpic(result.rows[0]);
  }

  async update(id: string, data: UpdateEpicRequest): Promise<Epic | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(data.title);
    }
    if (data.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(data.description);
    }
    if (data.story_points !== undefined) {
      updates.push(`story_points = $${paramIndex++}`);
      values.push(data.story_points);
    }
    if (data.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(data.status);
    }
    if (data.order_index !== undefined) {
      updates.push(`order_index = $${paramIndex++}`);
      values.push(data.order_index);
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE epics SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );
    return result.rows[0] ? this.mapRowToEpic(result.rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM epics WHERE id = $1', [id]);
    return result.rowCount > 0;
  }

  private mapRowToEpic(row: any): Epic {
    return {
      id: row.id,
      project_id: row.project_id,
      rfc_id: row.rfc_id,
      title: row.title,
      description: row.description,
      story_points: row.story_points,
      status: row.status,
      order_index: row.order_index,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }
}
