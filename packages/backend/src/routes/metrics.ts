import express from 'express';
import { Pool } from 'pg';

const router = express.Router();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'devflow_studio',
});

/**
 * GET /api/metrics/tdd/summary
 * Get TDD system metrics summary
 */
router.get('/tdd/summary', async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - Number(days));

    // Get session statistics
    const sessionsResult = await pool.query(`
      SELECT
        COUNT(*) as total_sessions,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_sessions,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_sessions,
        COUNT(CASE WHEN status IN ('running', 'pending', 'generating_tests', 'tests_generated', 'tdd_green', 'tdd_refactor', 'tdd_ready', 'tdd_implementing', 'tdd_refactoring') THEN 1 END) as in_progress_sessions,
        AVG(EXTRACT(EPOCH FROM (completed_at - created_at))) as avg_duration_seconds
      FROM coding_sessions
      WHERE created_at >= $1
        AND tdd_cycle IS NOT NULL
    `, [startDate]);

    // Get test execution statistics
    const testsResult = await pool.query(`
      SELECT
        COUNT(*) as total_test_suites,
        COUNT(CASE WHEN ts.status = 'passed' THEN 1 END) as passed_suites,
        COUNT(CASE WHEN ts.status = 'failed' THEN 1 END) as failed_suites,
        AVG(EXTRACT(EPOCH FROM (ts.executed_at - ts.generated_at))) as avg_execution_time_seconds
      FROM test_suites ts
      JOIN coding_sessions cs ON ts.coding_session_id = cs.id
      WHERE cs.created_at >= $1
        AND cs.tdd_cycle IS NOT NULL
    `, [startDate]);

    // Get retry statistics (if hybrid retry system is enabled)
    const retriesResult = await pool.query(`
      SELECT
        COUNT(*) as total_retries,
        COUNT(CASE WHEN status = 'passed' THEN 1 END) as successful_retries,
        AVG(retry_cost * attempts) as avg_budget_spent
      FROM test_retry_tracking
      WHERE created_at >= $1
    `, [startDate]);

    const sessions = sessionsResult.rows[0];
    const tests = testsResult.rows[0];
    const retries = retriesResult.rows[0];

    const summary = {
      period: {
        days: Number(days),
        start: startDate.toISOString(),
        end: new Date().toISOString()
      },
      sessions: {
        total: parseInt(sessions.total_sessions) || 0,
        completed: parseInt(sessions.completed_sessions) || 0,
        failed: parseInt(sessions.failed_sessions) || 0,
        inProgress: parseInt(sessions.in_progress_sessions) || 0,
        successRate: sessions.total_sessions > 0
          ? ((parseInt(sessions.completed_sessions) / parseInt(sessions.total_sessions)) * 100).toFixed(1)
          : '0.0',
        avgDuration: sessions.avg_duration_seconds
          ? `${(parseFloat(sessions.avg_duration_seconds) / 60).toFixed(1)} min`
          : 'N/A'
      },
      tests: {
        totalSuites: parseInt(tests.total_test_suites) || 0,
        passed: parseInt(tests.passed_suites) || 0,
        failed: parseInt(tests.failed_suites) || 0,
        successRate: tests.total_test_suites > 0
          ? ((parseInt(tests.passed_suites) / parseInt(tests.total_test_suites)) * 100).toFixed(1)
          : '0.0',
        avgExecutionTime: tests.avg_execution_time_seconds
          ? `${parseFloat(tests.avg_execution_time_seconds).toFixed(1)} sec`
          : 'N/A'
      },
      retries: {
        total: parseInt(retries.total_retries) || 0,
        successful: parseInt(retries.successful_retries) || 0,
        successRate: retries.total_retries > 0
          ? ((parseInt(retries.successful_retries) / parseInt(retries.total_retries)) * 100).toFixed(1)
          : '0.0',
        avgBudgetSpent: retries.avg_budget_spent
          ? parseFloat(retries.avg_budget_spent).toFixed(1)
          : 'N/A'
      }
    };

    res.json(summary);
  } catch (error: any) {
    console.error('[Metrics API] Error fetching TDD summary:', error);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

/**
 * GET /api/metrics/tdd/errors
 * Get error distribution
 */
router.get('/tdd/errors', async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - Number(days));

    // Get error types from test executions
    const errorsResult = await pool.query(`
      SELECT
        error_message,
        COUNT(*) as count
      FROM test_executions
      WHERE created_at >= $1
        AND status = 'failed'
        AND error_message IS NOT NULL
      GROUP BY error_message
      ORDER BY count DESC
      LIMIT 10
    `, [startDate]);

    const errors = errorsResult.rows.map(row => ({
      error: row.error_message.substring(0, 200), // Truncate long errors
      count: parseInt(row.count),
      percentage: 0 // Will calculate below
    }));

    const totalErrors = errors.reduce((sum, e) => sum + e.count, 0);
    errors.forEach(e => {
      e.percentage = totalErrors > 0 ? parseFloat(((e.count / totalErrors) * 100).toFixed(1)) : 0;
    });

    res.json({
      period: {
        days: Number(days),
        start: startDate.toISOString(),
        end: new Date().toISOString()
      },
      totalErrors,
      topErrors: errors
    });
  } catch (error: any) {
    console.error('[Metrics API] Error fetching error distribution:', error);
    res.status(500).json({ error: 'Failed to fetch error metrics' });
  }
});

/**
 * GET /api/metrics/tdd/timeline
 * Get metrics over time
 */
router.get('/tdd/timeline', async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - Number(days));

    // Get daily session statistics
    const timelineResult = await pool.query(`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as total_sessions,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
      FROM coding_sessions
      WHERE created_at >= $1
        AND tdd_cycle IS NOT NULL
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `, [startDate]);

    const timeline = timelineResult.rows.map(row => ({
      date: row.date,
      totalSessions: parseInt(row.total_sessions),
      completed: parseInt(row.completed),
      failed: parseInt(row.failed),
      successRate: row.total_sessions > 0
        ? parseFloat(((parseInt(row.completed) / parseInt(row.total_sessions)) * 100).toFixed(1))
        : 0
    }));

    res.json({
      period: {
        days: Number(days),
        start: startDate.toISOString(),
        end: new Date().toISOString()
      },
      timeline
    });
  } catch (error: any) {
    console.error('[Metrics API] Error fetching timeline:', error);
    res.status(500).json({ error: 'Failed to fetch timeline metrics' });
  }
});

export default router;
