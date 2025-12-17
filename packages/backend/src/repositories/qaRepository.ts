import { Pool } from 'pg';
import pool from '../config/database';
import { QASession, TestResult, QASessionStatus, TestStatus, TestType } from '@devflow-studio/shared';

export class QARepository {
  private pool: Pool;

  constructor() {
    this.pool = pool;
  }

  async create(data: {
    project_id: string;
    coding_session_id?: string;
    test_type?: TestType;
  }): Promise<QASession> {
    const result = await this.pool.query(
      `INSERT INTO qa_sessions (project_id, coding_session_id, test_type)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [data.project_id, data.coding_session_id, data.test_type]
    );
    return result.rows[0];
  }

  async findById(id: string): Promise<QASession | null> {
    const result = await this.pool.query(
      'SELECT * FROM qa_sessions WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  async findByProjectId(projectId: string): Promise<QASession[]> {
    const result = await this.pool.query(
      'SELECT * FROM qa_sessions WHERE project_id = $1 ORDER BY created_at DESC',
      [projectId]
    );
    return result.rows;
  }

  async findByProjectIdAndType(projectId: string, testType: TestType): Promise<QASession[]> {
    const result = await this.pool.query(
      'SELECT * FROM qa_sessions WHERE project_id = $1 AND test_type = $2 ORDER BY created_at DESC',
      [projectId, testType]
    );
    return result.rows;
  }

  async findByCodingSession(codingSessionId: string): Promise<QASession | null> {
    const result = await this.pool.query(
      'SELECT * FROM qa_sessions WHERE coding_session_id = $1 ORDER BY created_at DESC LIMIT 1',
      [codingSessionId]
    );
    return result.rows[0] || null;
  }

  async update(id: string, data: Partial<QASession>): Promise<QASession> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (data.status !== undefined) {
      fields.push(`status = $${paramCount++}`);
      values.push(data.status);
    }
    if (data.total_tests !== undefined) {
      fields.push(`total_tests = $${paramCount++}`);
      values.push(data.total_tests);
    }
    if (data.passed_tests !== undefined) {
      fields.push(`passed_tests = $${paramCount++}`);
      values.push(data.passed_tests);
    }
    if (data.failed_tests !== undefined) {
      fields.push(`failed_tests = $${paramCount++}`);
      values.push(data.failed_tests);
    }
    if (data.skipped_tests !== undefined) {
      fields.push(`skipped_tests = $${paramCount++}`);
      values.push(data.skipped_tests);
    }
    if (data.coverage_percentage !== undefined) {
      fields.push(`coverage_percentage = $${paramCount++}`);
      values.push(data.coverage_percentage);
    }
    if (data.report_path !== undefined) {
      fields.push(`report_path = $${paramCount++}`);
      values.push(data.report_path);
    }
    if (data.started_at !== undefined) {
      fields.push(`started_at = $${paramCount++}`);
      values.push(data.started_at);
    }
    if (data.completed_at !== undefined) {
      fields.push(`completed_at = $${paramCount++}`);
      values.push(data.completed_at);
    }
    if (data.test_type !== undefined) {
      fields.push(`test_type = $${paramCount++}`);
      values.push(data.test_type);
    }

    values.push(id);

    const result = await this.pool.query(
      `UPDATE qa_sessions SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );
    return result.rows[0];
  }

  async delete(id: string): Promise<void> {
    await this.pool.query('DELETE FROM qa_sessions WHERE id = $1', [id]);
  }

  // Test results methods
  async addTestResult(sessionId: string, test: Omit<TestResult, 'id' | 'session_id' | 'created_at'>): Promise<TestResult> {
    const result = await this.pool.query(
      `INSERT INTO test_results (session_id, test_name, test_type, status, duration, error_message, stack_trace, output)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        sessionId,
        test.test_name,
        test.test_type,
        test.status,
        test.duration,
        test.error_message,
        test.stack_trace,
        test.output,
      ]
    );
    return result.rows[0];
  }

  async getTestResults(sessionId: string): Promise<TestResult[]> {
    const result = await this.pool.query(
      'SELECT * FROM test_results WHERE session_id = $1 ORDER BY created_at ASC',
      [sessionId]
    );
    return result.rows;
  }

  async getDashboard(projectId: string) {
    const sessions = await this.findByProjectId(projectId);
    
    const stats = await this.pool.query(
      `SELECT 
        COUNT(*) as total_sessions,
        SUM(CASE WHEN status = 'completed' AND failed_tests = 0 THEN 1 ELSE 0 END) as passed_sessions,
        SUM(CASE WHEN status = 'completed' AND failed_tests > 0 THEN 1 ELSE 0 END) as failed_sessions,
        AVG(coverage_percentage) as avg_coverage
       FROM qa_sessions
       WHERE project_id = $1`,
      [projectId]
    );

    // Get stats segmented by test type
    const statsByType = await this.pool.query(
      `SELECT 
        test_type,
        COUNT(*) as total_sessions,
        SUM(CASE WHEN status = 'completed' AND failed_tests = 0 THEN 1 ELSE 0 END) as passed_sessions,
        SUM(CASE WHEN status = 'completed' AND failed_tests > 0 THEN 1 ELSE 0 END) as failed_sessions,
        AVG(coverage_percentage) as avg_coverage
       FROM qa_sessions
       WHERE project_id = $1 AND test_type IS NOT NULL
       GROUP BY test_type`,
      [projectId]
    );

    const lastSession = sessions.length > 0 ? sessions[0] : null;

    // Build by_type object
    const byType: any = {};
    for (const row of statsByType.rows) {
      const total = parseInt(row.total_sessions || '0');
      const passed = parseInt(row.passed_sessions || '0');
      byType[row.test_type] = {
        total_sessions: total,
        passed_sessions: passed,
        failed_sessions: parseInt(row.failed_sessions || '0'),
        average_coverage: row.avg_coverage ? parseFloat(row.avg_coverage) : undefined,
        pass_rate: total > 0 ? Math.round((passed / total) * 100) : 0,
      };
    }

    return {
      project_id: projectId,
      total_sessions: parseInt(stats.rows[0].total_sessions || '0'),
      passed_sessions: parseInt(stats.rows[0].passed_sessions || '0'),
      failed_sessions: parseInt(stats.rows[0].failed_sessions || '0'),
      average_coverage: stats.rows[0].avg_coverage ? parseFloat(stats.rows[0].avg_coverage) : undefined,
      last_session: lastSession,
      recent_sessions: sessions.slice(0, 10),
      by_type: byType,
    };
  }
}
