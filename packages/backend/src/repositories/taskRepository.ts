import pool from '../config/database';
import { Task, CreateTaskRequest, UpdateTaskRequest, TaskType, TaskStatus } from '@devflow-studio/shared';

export class TaskRepository {
  async findByProjectId(projectId: string): Promise<Task[]> {
    const result = await pool.query(
      'SELECT * FROM tasks WHERE project_id = $1 ORDER BY priority DESC, created_at DESC',
      [projectId]
    );
    return result.rows;
  }

  async findByProjectIdAndType(projectId: string, type: TaskType): Promise<Task[]> {
    const result = await pool.query(
      'SELECT * FROM tasks WHERE project_id = $1 AND type = $2 ORDER BY priority DESC, created_at DESC',
      [projectId, type]
    );
    return result.rows;
  }

  async findById(id: string): Promise<Task | null> {
    const result = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  async create(data: CreateTaskRequest): Promise<Task> {
    const result = await pool.query(
      `INSERT INTO tasks (project_id, title, description, type, priority, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        data.project_id,
        data.title,
        data.description || null,
        data.type,
        data.priority || 0,
        data.status || 'todo',
      ]
    );
    return result.rows[0];
  }

  async update(id: string, data: UpdateTaskRequest): Promise<Task | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (data.title !== undefined) {
      updates.push(`title = $${paramCount++}`);
      values.push(data.title);
    }
    if (data.description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(data.description);
    }
    if (data.status !== undefined) {
      updates.push(`status = $${paramCount++}`);
      values.push(data.status);
    }
    if (data.priority !== undefined) {
      updates.push(`priority = $${paramCount++}`);
      values.push(data.priority);
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const result = await pool.query(
      `UPDATE tasks SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );
    return result.rows[0] || null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
    return result.rowCount > 0;
  }
}

