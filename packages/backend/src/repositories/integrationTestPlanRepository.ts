import { Pool } from 'pg';
import pool from '../config/database';
import { TestPlan, TestPlanItem, TestType } from '@devflow-studio/shared';

export class IntegrationTestPlanRepository {
  private pool: Pool;

  constructor() {
    this.pool = pool;
  }

  async create(data: {
    project_id: string;
    qa_session_id?: string;
    coding_session_id?: string;
    test_type: TestType;
    items?: TestPlanItem[];
  }): Promise<TestPlan> {
    const result = await this.pool.query(
      `INSERT INTO test_plans (project_id, qa_session_id, coding_session_id, test_type, items)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        data.project_id,
        data.qa_session_id,
        data.coding_session_id,
        data.test_type,
        JSON.stringify(data.items || [])
      ]
    );
    return this.mapRowToPlan(result.rows[0]);
  }

  async findById(id: string): Promise<TestPlan | null> {
    const result = await this.pool.query(
      'SELECT * FROM test_plans WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      return null;
    }
    return this.mapRowToPlan(result.rows[0]);
  }

  async findByProjectId(projectId: string): Promise<TestPlan[]> {
    const result = await this.pool.query(
      'SELECT * FROM test_plans WHERE project_id = $1 ORDER BY created_at DESC',
      [projectId]
    );
    return result.rows.map(row => this.mapRowToPlan(row));
  }

  async findByQASession(qaSessionId: string): Promise<TestPlan | null> {
    const result = await this.pool.query(
      'SELECT * FROM test_plans WHERE qa_session_id = $1 ORDER BY created_at DESC LIMIT 1',
      [qaSessionId]
    );
    if (result.rows.length === 0) {
      return null;
    }
    return this.mapRowToPlan(result.rows[0]);
  }

  async findByCodingSession(codingSessionId: string): Promise<TestPlan | null> {
    const result = await this.pool.query(
      'SELECT * FROM test_plans WHERE coding_session_id = $1 ORDER BY created_at DESC LIMIT 1',
      [codingSessionId]
    );
    if (result.rows.length === 0) {
      return null;
    }
    return this.mapRowToPlan(result.rows[0]);
  }

  async findByQASessionAndType(qaSessionId: string, testType: TestType): Promise<TestPlan | null> {
    const result = await this.pool.query(
      'SELECT * FROM test_plans WHERE qa_session_id = $1 AND test_type = $2 ORDER BY created_at DESC LIMIT 1',
      [qaSessionId, testType]
    );
    if (result.rows.length === 0) {
      return null;
    }
    return this.mapRowToPlan(result.rows[0]);
  }

  async update(id: string, data: {
    items?: TestPlanItem[];
    status?: 'draft' | 'approved' | 'executing' | 'completed';
  }): Promise<TestPlan> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (data.items !== undefined) {
      fields.push(`items = $${paramCount++}`);
      values.push(JSON.stringify(data.items));
    }
    if (data.status !== undefined) {
      fields.push(`status = $${paramCount++}`);
      values.push(data.status);
    }

    values.push(id);

    const result = await this.pool.query(
      `UPDATE test_plans SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );
    return this.mapRowToPlan(result.rows[0]);
  }

  async delete(id: string): Promise<void> {
    await this.pool.query('DELETE FROM test_plans WHERE id = $1', [id]);
  }

  private mapRowToPlan(row: any): TestPlan {
    return {
      id: row.id,
      project_id: row.project_id,
      qa_session_id: row.qa_session_id,
      coding_session_id: row.coding_session_id,
      test_type: row.test_type,
      items: Array.isArray(row.items) ? row.items : (typeof row.items === 'string' ? JSON.parse(row.items) : []),
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
