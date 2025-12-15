import pool from '../config/database';
import { Project, CreateProjectRequest, UpdateProjectRequest } from '@devflow-studio/shared';

export class ProjectRepository {
  async findAll(): Promise<Project[]> {
    const result = await pool.query('SELECT * FROM projects ORDER BY created_at DESC');
    return result.rows;
  }

  async findById(id: string): Promise<Project | null> {
    const result = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  async create(data: CreateProjectRequest): Promise<Project> {
    const result = await pool.query(
      `INSERT INTO projects (name, base_path, tech_stack)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [data.name, data.base_path, data.tech_stack || null]
    );
    return result.rows[0];
  }

  async update(id: string, data: UpdateProjectRequest): Promise<Project | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(data.name);
    }
    if (data.tech_stack !== undefined) {
      updates.push(`tech_stack = $${paramCount++}`);
      values.push(data.tech_stack);
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const result = await pool.query(
      `UPDATE projects SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );
    return result.rows[0] || null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM projects WHERE id = $1', [id]);
    return result.rowCount > 0;
  }
}

