import pool from '../config/database';
import { UserFlow, GenerateUserFlowRequest } from '@devflow-studio/shared';

export class UserFlowRepository {
  async findByProjectId(projectId: string): Promise<UserFlow[]> {
    const result = await pool.query(
      'SELECT * FROM user_flows WHERE project_id = $1 ORDER BY created_at DESC',
      [projectId]
    );
    return result.rows.map((row: any) => this.mapRowToUserFlow(row));
  }

  async findById(id: string): Promise<UserFlow | null> {
    const result = await pool.query(
      'SELECT * FROM user_flows WHERE id = $1',
      [id]
    );
    return result.rows[0] ? this.mapRowToUserFlow(result.rows[0]) : null;
  }

  async create(data: GenerateUserFlowRequest & { flow_diagram?: string }): Promise<UserFlow> {
    const result = await pool.query(
      `INSERT INTO user_flows (project_id, flow_name, flow_diagram, description)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        data.project_id,
        data.flow_name,
        data.flow_diagram || null,
        data.description || null,
      ]
    );
    return this.mapRowToUserFlow(result.rows[0]);
  }

  async update(id: string, data: Partial<{ flow_diagram: string; description: string }>): Promise<UserFlow | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.flow_diagram !== undefined) {
      updates.push(`flow_diagram = $${paramIndex++}`);
      values.push(data.flow_diagram);
    }
    if (data.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(data.description);
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE user_flows SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );
    return result.rows[0] ? this.mapRowToUserFlow(result.rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM user_flows WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  private mapRowToUserFlow(row: any): UserFlow {
    return {
      id: row.id,
      project_id: row.project_id,
      flow_name: row.flow_name,
      flow_diagram: row.flow_diagram,
      description: row.description,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }
}
