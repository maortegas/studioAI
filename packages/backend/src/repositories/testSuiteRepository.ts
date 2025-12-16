import pool from '../config/database';
import { TestSuite, CreateTestSuiteRequest, UpdateTestSuiteRequest, TestExecution } from '@devflow-studio/shared';

export class TestSuiteRepository {
  async create(data: CreateTestSuiteRequest): Promise<TestSuite> {
    const result = await pool.query(
      `INSERT INTO test_suites (project_id, coding_session_id, story_id, name, description, test_type, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        data.project_id,
        data.coding_session_id || null,
        data.story_id || null,
        data.name,
        data.description || null,
        data.test_type,
        'pending',
      ]
    );
    return result.rows[0];
  }

  async findById(id: string): Promise<TestSuite | null> {
    const result = await pool.query('SELECT * FROM test_suites WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  async findByCodingSession(codingSessionId: string): Promise<TestSuite[]> {
    const result = await pool.query(
      'SELECT * FROM test_suites WHERE coding_session_id = $1 ORDER BY created_at ASC',
      [codingSessionId]
    );
    return result.rows;
  }

  async findByStory(storyId: string): Promise<TestSuite[]> {
    const result = await pool.query(
      'SELECT * FROM test_suites WHERE story_id = $1 ORDER BY created_at ASC',
      [storyId]
    );
    return result.rows;
  }

  async findByProject(projectId: string): Promise<TestSuite[]> {
    const result = await pool.query(
      'SELECT * FROM test_suites WHERE project_id = $1 ORDER BY created_at DESC',
      [projectId]
    );
    return result.rows;
  }

  async update(id: string, data: UpdateTestSuiteRequest): Promise<TestSuite | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(data.name);
    }
    if (data.description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(data.description);
    }
    if (data.test_code !== undefined) {
      updates.push(`test_code = $${paramCount++}`);
      values.push(data.test_code);
    }
    if (data.status !== undefined) {
      updates.push(`status = $${paramCount++}`);
      values.push(data.status);
    }

    if (updates.length === 0) {
      return await this.findById(id);
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE test_suites SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );
    return result.rows[0] || null;
  }

  async delete(id: string): Promise<void> {
    await pool.query('DELETE FROM test_suites WHERE id = $1', [id]);
  }

  async createExecution(data: {
    test_suite_id: string;
    execution_type: string;
    status: string;
  }): Promise<TestExecution> {
    const result = await pool.query(
      `INSERT INTO test_executions (test_suite_id, execution_type, status)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [data.test_suite_id, data.execution_type, data.status]
    );
    return result.rows[0];
  }

  async updateExecution(id: string, data: {
    status?: string;
    completed_at?: Date;
    duration?: number;
    total_tests?: number;
    passed_tests?: number;
    failed_tests?: number;
    skipped_tests?: number;
    output?: string;
    error_message?: string;
  }): Promise<TestExecution | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (data.status !== undefined) {
      updates.push(`status = $${paramCount++}`);
      values.push(data.status);
    }
    if (data.completed_at !== undefined) {
      updates.push(`completed_at = $${paramCount++}`);
      values.push(data.completed_at);
    }
    if (data.duration !== undefined) {
      updates.push(`duration = $${paramCount++}`);
      values.push(data.duration);
    }
    if (data.total_tests !== undefined) {
      updates.push(`total_tests = $${paramCount++}`);
      values.push(data.total_tests);
    }
    if (data.passed_tests !== undefined) {
      updates.push(`passed_tests = $${paramCount++}`);
      values.push(data.passed_tests);
    }
    if (data.failed_tests !== undefined) {
      updates.push(`failed_tests = $${paramCount++}`);
      values.push(data.failed_tests);
    }
    if (data.skipped_tests !== undefined) {
      updates.push(`skipped_tests = $${paramCount++}`);
      values.push(data.skipped_tests);
    }
    if (data.output !== undefined) {
      updates.push(`output = $${paramCount++}`);
      values.push(data.output);
    }
    if (data.error_message !== undefined) {
      updates.push(`error_message = $${paramCount++}`);
      values.push(data.error_message);
    }

    if (updates.length === 0) {
      const result = await pool.query('SELECT * FROM test_executions WHERE id = $1', [id]);
      return result.rows[0] || null;
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE test_executions SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );
    return result.rows[0] || null;
  }

  async getExecutions(testSuiteId: string): Promise<TestExecution[]> {
    const result = await pool.query(
      'SELECT * FROM test_executions WHERE test_suite_id = $1 ORDER BY started_at DESC',
      [testSuiteId]
    );
    return result.rows;
  }
}
