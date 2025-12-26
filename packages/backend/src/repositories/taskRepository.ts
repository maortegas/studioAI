import pool from '../config/database';
import { Task, CreateTaskRequest, UpdateTaskRequest, TaskType, TaskStatus } from '@devflow-studio/shared';

export class TaskRepository {
  async findByProjectId(projectId: string): Promise<Task[]> {
    const result = await pool.query(
      'SELECT * FROM tasks WHERE project_id = $1 ORDER BY priority DESC, created_at DESC',
      [projectId]
    );
    return result.rows.map(row => this.mapRowToTask(row));
  }

  async findByProjectIdAndType(projectId: string, type: TaskType): Promise<Task[]> {
    const result = await pool.query(
      'SELECT * FROM tasks WHERE project_id = $1 AND type = $2 ORDER BY priority DESC, created_at DESC',
      [projectId, type]
    );
    return result.rows.map(row => this.mapRowToTask(row));
  }

  async findById(id: string): Promise<Task | null> {
    const result = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
    return result.rows[0] ? this.mapRowToTask(result.rows[0]) : null;
  }

  async create(data: CreateTaskRequest): Promise<Task> {
    // Handle acceptance_criteria and other new fields
    const acceptanceCriteria = (data as any).acceptance_criteria;
    const generatedFromPRD = (data as any).generated_from_prd || false;
    const storyPoints = (data as any).story_points;
    const epicId = (data as any).epic_id;
    const estimatedDays = (data as any).estimated_days;
    const breakdownOrder = (data as any).breakdown_order;

    // Validate project exists
    const projectCheck = await pool.query(
      'SELECT id FROM projects WHERE id = $1',
      [data.project_id]
    );
    if (projectCheck.rows.length === 0) {
      throw new Error(`Project ${data.project_id} not found`);
    }

    // Validate epic_id if provided
    if (epicId) {
      const epicCheck = await pool.query(
        'SELECT id, project_id FROM epics WHERE id = $1',
        [epicId]
      );
      if (epicCheck.rows.length === 0) {
        throw new Error(`Epic ${epicId} not found`);
      }
      if (epicCheck.rows[0].project_id !== data.project_id) {
        throw new Error(`Epic ${epicId} does not belong to project ${data.project_id}`);
      }
    }

    // Validate task type rules:
    // - 'task' (breakdown task) must have epic_id
    // - 'story' (user story) should not have epic_id (stories are independent)
    if (data.type === 'task' && !epicId) {
      throw new Error('Breakdown tasks (type="task") must have an epic_id');
    }
    
    // Force epic_id to null for stories (stories are independent, not linked to epics)
    const finalEpicId = data.type === 'story' ? null : epicId;
    if (data.type === 'story' && epicId) {
      console.warn(`[TaskRepository] Warning: User story (type="story") should not have epic_id. Removing epic_id.`);
    }

    const result = await pool.query(
      `INSERT INTO tasks (project_id, title, description, type, priority, status, acceptance_criteria, generated_from_prd, story_points, epic_id, estimated_days, breakdown_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        data.project_id,
        data.title,
        data.description || null,
        data.type,
        data.priority || 0,
        data.status || 'todo',
        acceptanceCriteria ? JSON.stringify(acceptanceCriteria) : null,
        generatedFromPRD,
        storyPoints || null,
        finalEpicId || null, // Force null for stories, use epicId for breakdown tasks
        estimatedDays || null,
        breakdownOrder || null,
      ]
    );
    return this.mapRowToTask(result.rows[0]);
  }

  private mapRowToTask(row: any): Task {
    const task: any = {
      id: row.id,
      project_id: row.project_id,
      title: row.title,
      description: row.description,
      status: row.status,
      type: row.type,
      priority: row.priority,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
    // Add new fields if they exist
    if (row.acceptance_criteria) {
      task.acceptance_criteria = typeof row.acceptance_criteria === 'string' 
        ? JSON.parse(row.acceptance_criteria) 
        : row.acceptance_criteria;
    }
    if (row.generated_from_prd !== undefined) task.generated_from_prd = row.generated_from_prd;
    if (row.story_points !== undefined) task.story_points = row.story_points;
    if (row.epic_id) task.epic_id = row.epic_id;
    if (row.estimated_days !== undefined) task.estimated_days = row.estimated_days;
    if (row.breakdown_order !== undefined) task.breakdown_order = row.breakdown_order;
    return task;
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
    return (result.rowCount ?? 0) > 0;
  }
}

