/**
 * RetryOrchestrator
 *
 * Orchestrates the retry execution flow for the Hybrid Retry System:
 * - Manages retry queue execution
 * - Creates AI jobs for individual test retries
 * - Handles retry completion and state updates
 * - Coordinates with RetryStrategyService
 */

import { Pool } from 'pg';
import { RetryStrategyService } from '../../backend/src/services/retryStrategyService';
import {
  TestRetryTracking,
  RetryResult,
  OrchestrationResult,
  CompletionStatus,
  TestRetryStatus
} from '@devflow-studio/shared';

export class RetryOrchestrator {
  private pool: Pool;
  private retryStrategy: RetryStrategyService;

  constructor(pool?: Pool) {
    this.pool = pool || new Pool({
      connectionString: process.env.DATABASE_URL
    });
    this.retryStrategy = new RetryStrategyService(this.pool);
  }

  /**
   * Main orchestration method: manages retry execution until completion
   */
  async orchestrateRetries(sessionId: string): Promise<OrchestrationResult> {
    const startTime = Date.now();
    let testsProcessed = 0;
    let budgetSpent = 0;

    console.log(`[RetryOrchestrator] Starting retry orchestration for session ${sessionId}`);

    try {
      // Update budget tracking phase
      await this.retryStrategy.updateBudgetTracking(sessionId, {
        strategy_phase: 'executing'
      });

      // Main retry loop
      while (true) {
        // 1. Get next test to retry
        const nextTest = await this.retryStrategy.getNextTestToRetry(sessionId);

        if (!nextTest) {
          console.log(`[RetryOrchestrator] No more tests to retry`);
          break;
        }

        // 2. Retry individual test
        console.log(`[RetryOrchestrator] Processing test: ${nextTest.test_name} (priority: ${nextTest.priority_score}, cost: ${nextTest.retry_cost})`);
        const result = await this.retryIndividualTest(sessionId, nextTest);

        if (result.success) {
          testsProcessed++;
          budgetSpent += nextTest.retry_cost;
        } else if (result.skipped) {
          console.log(`[RetryOrchestrator] Skipped test ${nextTest.test_name}: ${result.reason}`);
        }

        // 3. Check if session should complete
        const evaluation = await this.retryStrategy.evaluateSessionCompletion(sessionId);

        if (evaluation.should_complete) {
          console.log(`[RetryOrchestrator] Session completion criteria met: ${evaluation.reason}`);
          await this.completeSession(sessionId, evaluation.status!);
          break;
        }

        // 4. Emit progress event
        await this.emitProgressEvent(sessionId);
      }

      // Generate final report
      const report = await this.retryStrategy.generateCompletionReport(sessionId);
      const duration = Date.now() - startTime;

      console.log(`[RetryOrchestrator] Orchestration complete for session ${sessionId}`);
      console.log(`[RetryOrchestrator] Tests processed: ${testsProcessed}, Budget spent: ${budgetSpent}, Duration: ${duration}ms`);

      return {
        session_id: sessionId,
        completed: true,
        status: report.status,
        tests_processed: testsProcessed,
        budget_spent: budgetSpent,
        duration_ms: duration,
        report
      };
    } catch (error: any) {
      console.error(`[RetryOrchestrator] Error during orchestration:`, error);

      // Mark session as failed
      await this.retryStrategy.updateBudgetTracking(sessionId, {
        strategy_phase: 'failed'
      });

      throw error;
    }
  }

  /**
   * Retry a single test
   */
  async retryIndividualTest(sessionId: string, testTracking: TestRetryTracking): Promise<RetryResult> {
    try {
      // 1. Check if retry should proceed
      const decision = await this.retryStrategy.shouldRetryTest(testTracking.id);

      if (!decision.retry) {
        console.log(`[RetryOrchestrator] Test ${testTracking.test_name} not eligible for retry: ${decision.reason}`);
        return { success: false, skipped: true, reason: decision.reason };
      }

      // 2. Emit retry attempt event
      await this.emitRetryAttemptEvent(sessionId, testTracking);

      // 3. Increment attempt counter
      await this.retryStrategy.incrementTestAttempts(testTracking.id);

      // 4. Build focused prompt for THIS test only
      const prompt = await this.buildSingleTestRetryPrompt(sessionId, testTracking);

      // 5. Create AI job
      const session = await this.getCodingSession(sessionId);
      const aiJob = await this.createAIJob({
        project_id: session.project_id,
        task_id: session.story_id,
        provider: 'cursor',
        command: 'cursor',  // Provider goes in command field
        prompt: prompt,
        args: {
          mode: 'agent',  // Mode goes in args.mode
          coding_session_id: sessionId,
          phase: 'tdd_individual_retry',
          test_retry_tracking_id: testTracking.id,
          attempt_number: testTracking.attempts + 1,
          budget_cost: testTracking.retry_cost
        }
      });

      // 6. Spend budget
      await this.retryStrategy.spendBudget(sessionId, testTracking.retry_cost);

      // 7. Create retry execution log
      await this.retryStrategy.createRetryExecutionLog({
        coding_session_id: sessionId,
        test_retry_tracking_id: testTracking.id,
        attempt_number: testTracking.attempts + 1,
        budget_cost: testTracking.retry_cost,
        ai_job_id: aiJob.id,
        decision_reason: `Priority score: ${testTracking.priority_score}`,
        priority_score: testTracking.priority_score
      });

      console.log(`[RetryOrchestrator] Created AI job ${aiJob.id} for test ${testTracking.test_name} (attempt ${testTracking.attempts + 1}/${testTracking.max_attempts})`);

      return { success: true, ai_job_id: aiJob.id };
    } catch (error: any) {
      console.error(`[RetryOrchestrator] Error retrying test ${testTracking.test_name}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle retry job completion (called by worker after AI job finishes)
   */
  async handleRetryJobComplete(
    jobId: string,
    sessionId: string,
    testTrackingId: string,
    result: { success: boolean; output?: string; error?: string }
  ): Promise<void> {
    console.log(`[RetryOrchestrator] Handling retry job completion for job ${jobId}`);

    try {
      // 1. Get test tracking
      const testTracking = await this.retryStrategy.getTestRetryTrackingById(testTrackingId);
      if (!testTracking) {
        console.error(`[RetryOrchestrator] Test tracking not found: ${testTrackingId}`);
        return;
      }

      // 2. Execute the specific test to verify result
      const testResult = await this.executeSpecificTest(sessionId, testTracking.test_suite_id);

      // 3. Update retry execution log
      const logs = await this.retryStrategy.getRetryExecutionLogs(sessionId);
      const currentLog = logs.find(log => log.ai_job_id === jobId);

      if (currentLog) {
        await this.retryStrategy.updateRetryExecutionLog(currentLog.id, {
          success: testResult.passed,
          error_message: testResult.error || undefined,
          error_hash: testResult.error ? this.hashError(testResult.error) : undefined,
          test_output: testResult.output,
          completed_at: new Date(),
          duration_ms: Date.now() - currentLog.started_at.getTime()
        });
      }

      // 4. Check circuit breaker
      if (testResult.error) {
        const circuitBreakerTriggered = await this.retryStrategy.checkCircuitBreaker(
          testTrackingId,
          testResult.error
        );

        if (circuitBreakerTriggered) {
          console.log(`[RetryOrchestrator] Circuit breaker triggered for ${testTracking.test_name}. Skipping and trying other tests.`);

          // Emit circuit breaker event
          await this.emitTestRetryCompleteEvent(sessionId, testTracking, testResult.passed, true);

          // Continue with next test
          await this.continueWithNextTest(sessionId);
          return;
        }
      }

      // 5. Update test status based on result
      if (testResult.passed) {
        // Test passed! Update status
        await this.retryStrategy.updateTestRetryTracking(testTrackingId, {
          status: 'passing' as TestRetryStatus
        });

        await this.retryStrategy.updateBudgetTracking(sessionId, {
          tests_passing: testTracking.coding_session_id === sessionId
            ? (await this.retryStrategy.getBudgetTracking(sessionId)).tests_passing + 1
            : 0,
          tests_failing: testTracking.coding_session_id === sessionId
            ? (await this.retryStrategy.getBudgetTracking(sessionId)).tests_failing - 1
            : 0
        });

        console.log(`[RetryOrchestrator] ✅ Test ${testTracking.test_name} now passing after ${testTracking.attempts} attempts`);
      } else {
        // Test still failing
        if (testTracking.attempts >= testTracking.max_attempts) {
          // Max attempts reached - mark as permanently failed
          await this.retryStrategy.updateTestRetryTracking(testTrackingId, {
            status: 'permanently_failed' as TestRetryStatus
          });

          const budget = await this.retryStrategy.getBudgetTracking(sessionId);
          await this.retryStrategy.updateBudgetTracking(sessionId, {
            tests_permanently_failed: budget.tests_permanently_failed + 1,
            tests_failing: budget.tests_failing - 1
          });

          console.log(`[RetryOrchestrator] ❌ Test ${testTracking.test_name} permanently failed after ${testTracking.attempts} attempts`);
        } else {
          console.log(`[RetryOrchestrator] ⚠️  Test ${testTracking.test_name} still failing (attempt ${testTracking.attempts}/${testTracking.max_attempts})`);
        }
      }

      // 6. Emit completion event
      await this.emitTestRetryCompleteEvent(sessionId, testTracking, testResult.passed, false);

      // 7. Check if session should complete
      const evaluation = await this.retryStrategy.evaluateSessionCompletion(sessionId);

      if (evaluation.should_complete) {
        console.log(`[RetryOrchestrator] Session completion criteria met: ${evaluation.reason}`);
        await this.completeSession(sessionId, evaluation.status!);
      } else {
        // Continue with next test
        await this.continueWithNextTest(sessionId);
      }
    } catch (error: any) {
      console.error(`[RetryOrchestrator] Error handling retry job completion:`, error);
    }
  }

  /**
   * Continue orchestration with next test in queue
   */
  async continueWithNextTest(sessionId: string): Promise<void> {
    console.log(`[RetryOrchestrator] Continuing with next test for session ${sessionId}`);

    const nextTest = await this.retryStrategy.getNextTestToRetry(sessionId);

    if (nextTest) {
      await this.retryIndividualTest(sessionId, nextTest);
    } else {
      // No more tests - evaluate completion
      const evaluation = await this.retryStrategy.evaluateSessionCompletion(sessionId);
      if (evaluation.should_complete) {
        await this.completeSession(sessionId, evaluation.status!);
      }
    }
  }

  /**
   * Complete the session with final status
   */
  private async completeSession(sessionId: string, status: CompletionStatus): Promise<void> {
    console.log(`[RetryOrchestrator] Completing session ${sessionId} with status: ${status}`);

    // 1. Update budget tracking phase
    await this.retryStrategy.updateBudgetTracking(sessionId, {
      strategy_phase: status === 'completed' ? 'completed' : 'failed'
    });

    // 2. Generate completion report
    const report = await this.retryStrategy.generateCompletionReport(sessionId);

    // 3. Update coding session status
    let sessionStatus: string;
    let errorMessage: string | null = null;

    if (status === 'completed') {
      sessionStatus = 'completed';
    } else if (status === 'completed_with_warnings') {
      sessionStatus = 'completed';
      errorMessage = `Completed with warnings: ${report.warnings?.join('; ')}`;
    } else {
      sessionStatus = 'failed';
      errorMessage = `Failed: ${report.summary.tests_permanently_failed} tests permanently failed, ${report.summary.tests_failing} tests still failing`;
    }

    await this.pool.query(
      `UPDATE coding_sessions
       SET status = $1,
           error = $2,
           implementation_progress = $3
       WHERE id = $4`,
      [
        sessionStatus,
        errorMessage,
        Math.round(report.summary.success_rate * 100),
        sessionId
      ]
    );

    // 4. Emit completion event
    await this.emitCompletionEvent(sessionId, report);

    console.log(`[RetryOrchestrator] Session ${sessionId} completed. Status: ${status}, Success rate: ${Math.round(report.summary.success_rate * 100)}%`);
  }

  /**
   * Handle budget exhaustion
   */
  async handleBudgetExhausted(sessionId: string): Promise<void> {
    console.log(`[RetryOrchestrator] Budget exhausted for session ${sessionId}`);

    await this.retryStrategy.updateBudgetTracking(sessionId, {
      strategy_phase: 'budget_exhausted'
    });

    const budget = await this.retryStrategy.getBudgetTracking(sessionId);
    const passingRate = budget.tests_passing / budget.total_tests;

    const status: CompletionStatus = passingRate >= 0.9 ? 'completed_with_warnings' : 'failed';

    await this.pool.query(
      `INSERT INTO coding_session_events (session_id, event_type, payload)
       VALUES ($1, $2, $3)`,
      [
        sessionId,
        'budget_exhausted',
        JSON.stringify({
          budget_spent: budget.budget_spent,
          tests_passing: budget.tests_passing,
          tests_failing: budget.tests_failing,
          completion_status: status
        })
      ]
    );

    await this.completeSession(sessionId, status);
  }

  /**
   * Handle circuit breaker activation
   */
  async handleCircuitBreakerTriggered(sessionId: string, testId: string): Promise<void> {
    const test = await this.retryStrategy.getTestRetryTrackingById(testId);
    if (!test) return;

    console.log(`[RetryOrchestrator] Circuit breaker triggered for test ${test.test_name} in session ${sessionId}`);

    await this.pool.query(
      `INSERT INTO coding_session_events (session_id, event_type, payload)
       VALUES ($1, $2, $3)`,
      [
        sessionId,
        'circuit_breaker_triggered',
        JSON.stringify({
          test_name: test.test_name,
          consecutive_identical_errors: test.consecutive_identical_errors,
          attempts: test.attempts,
          last_error: test.error_history.length > 0
            ? test.error_history[test.error_history.length - 1].error_message
            : 'Unknown'
        })
      ]
    );
  }

  // ==========================================
  // HELPER METHODS
  // ==========================================

  /**
   * Build focused prompt for single test retry
   * PHASE 2: Enhanced with AgentDB context
   */
  private async buildSingleTestRetryPrompt(sessionId: string, test: TestRetryTracking): Promise<string> {
    const session = await this.getCodingSession(sessionId);
    const story = await this.getStory(session.story_id);
    const project = await this.getProject(session.project_id);

    // Get test suite details
    const testSuite = await this.getTestSuite(test.test_suite_id);

    // Get last error from history
    const lastError = test.error_history.length > 0
      ? test.error_history[test.error_history.length - 1].error_message
      : 'Unknown error';

    // PHASE 2: Load AgentDB context for better retry context
    let agentdbContext: string | null = null;
    try {
      const { AgentDBStateManager } = await import('../../backend/src/services/agentdb/AgentDBStateManager');
      const { AgentDBContextManager } = await import('../../backend/src/services/agentdb/AgentDBContextManager');

      const stateManager = new AgentDBStateManager(project.base_path, sessionId);
      const contextManager = new AgentDBContextManager(project.base_path, sessionId);

      // Get TDD state
      const state = await stateManager.loadState();

      // Get recent decisions related to this test
      const decisions = await contextManager.getRecentDecisions(10);

      if (state || decisions.length > 0) {
        const contextLines: string[] = [];
        contextLines.push(`## AgentDB Context (Previous Attempts)\n`);

        if (state && state.history && state.history.length > 0) {
          contextLines.push(`**Recent Actions**:\n`);
          state.history.slice(-5).forEach((entry: any) => {
            contextLines.push(`- ${entry.action} (${new Date(entry.timestamp).toLocaleString()})\n`);
          });
          contextLines.push(`\n`);
        }

        if (decisions.length > 0) {
          contextLines.push(`**AI Decisions Made**:\n`);
          decisions.forEach((decision: any, idx: number) => {
            contextLines.push(`${idx + 1}. ${decision.action}: ${decision.reason}\n`);
            if (decision.code_snippet) {
              contextLines.push(`   Code: ${decision.code_snippet.substring(0, 100)}...\n`);
            }
          });
          contextLines.push(`\n`);
        }

        agentdbContext = contextLines.join('');
      }
    } catch (error: any) {
      console.warn(`[RetryOrchestrator] Could not load AgentDB context: ${error.message}`);
      // Continue without context
    }

    const lines: string[] = [];

    lines.push(`# Test Retry - Focused Fix\n`);
    lines.push(`**Attempt**: ${test.attempts + 1}/${test.max_attempts}\n`);
    lines.push(`**Test**: ${test.test_name}\n`);
    lines.push(`**Complexity**: ${test.complexity_level || 'unknown'}\n`);
    lines.push(`**Error Type**: ${test.error_type || 'unknown'}\n\n`);

    if (test.consecutive_identical_errors > 0) {
      lines.push(`**⚠️ WARNING**: This test has failed with identical error ${test.consecutive_identical_errors} time(s).\n`);
      lines.push(`You MUST try a DIFFERENT approach than previous attempts.\n\n`);
    }

    lines.push(`## Story Context\n`);
    lines.push(`**Title**: ${story.title}\n`);
    if (story.description) {
      lines.push(`**Description**: ${story.description}\n\n`);
    }

    // PHASE 2: Include AgentDB context if available
    if (agentdbContext) {
      lines.push(agentdbContext);
    }

    lines.push(`## Test Code\n`);
    lines.push(`\`\`\`${testSuite.file_path?.endsWith('.ts') ? 'typescript' : 'javascript'}\n`);
    lines.push(`${testSuite.test_code}\n`);
    lines.push(`\`\`\`\n\n`);

    lines.push(`## Last Error\n`);
    lines.push(`\`\`\`\n`);
    lines.push(`${lastError}\n`);
    lines.push(`\`\`\`\n\n`);

    if (test.error_history.length > 1) {
      lines.push(`## Previous Errors (${test.error_history.length - 1} attempts)\n`);
      test.error_history.slice(0, -1).forEach((entry, index) => {
        lines.push(`**Attempt ${entry.attempt}**: ${entry.error_message.substring(0, 200)}...\n`);
      });
      lines.push(`\n`);
    }

    lines.push(`## Your Task\n`);
    lines.push(`1. Analyze the test code and error message\n`);
    lines.push(`2. Identify the root cause of the failure\n`);
    lines.push(`3. Implement ONLY the changes needed to make THIS test pass\n`);
    lines.push(`4. Do NOT modify other tests or unrelated code\n`);
    lines.push(`5. Ensure your changes follow the project structure:\n`);
    lines.push(`   - Tech stack: ${project.tech_stack}\n`);
    lines.push(`   - Base path: ${project.base_path}\n\n`);

    if (test.complexity_level === 'complex' || test.error_type === 'dependency') {
      lines.push(`**Note**: This is a ${test.complexity_level} ${test.error_type} error. You may need to:\n`);
      lines.push(`- Install missing dependencies (update package.json)\n`);
      lines.push(`- Fix import/export statements\n`);
      lines.push(`- Adjust configuration files\n\n`);
    }

    lines.push(`**IMPORTANT**: Focus ONLY on making this single test pass. Do not refactor unrelated code.\n`);

    return lines.join('\n');
  }

  /**
   * Execute a specific test suite
   */
  private async executeSpecificTest(sessionId: string, testSuiteId: string): Promise<{
    passed: boolean;
    error?: string;
    output?: string;
  }> {
    // Get test suite
    const testSuite = await this.getTestSuite(testSuiteId);
    const session = await this.getCodingSession(sessionId);
    const project = await this.getProject(session.project_id);

    // Execute test using npm test with specific file
    const { spawn } = require('child_process');

    const testResult = await new Promise<{ passed: boolean; error?: string; output?: string }>((resolve) => {
      const childProcess = spawn('npm', ['test', '--', testSuite.file_path], {
        cwd: project.base_path,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let output = '';
      let errorOutput = '';

      childProcess.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });

      childProcess.stderr.on('data', (data: Buffer) => {
        errorOutput += data.toString();
      });

      childProcess.on('close', (code: number | null) => {
        const fullOutput = output + errorOutput;
        resolve({
          passed: code === 0,
          output: fullOutput,
          error: code !== 0 ? errorOutput : undefined
        });
      });

      childProcess.on('error', (error: Error) => {
        resolve({
          passed: false,
          error: error.message,
          output: errorOutput
        });
      });
    });

    return testResult;
  }

  /**
   * Hash error message (MD5)
   */
  private hashError(error: string): string {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(error).digest('hex');
  }

  // ==========================================
  // DATABASE QUERIES
  // ==========================================

  private async getCodingSession(sessionId: string): Promise<any> {
    const result = await this.pool.query(
      'SELECT * FROM coding_sessions WHERE id = $1',
      [sessionId]
    );
    return result.rows[0];
  }

  private async getStory(storyId: string): Promise<any> {
    const result = await this.pool.query(
      'SELECT * FROM tasks WHERE id = $1',
      [storyId]
    );
    return result.rows[0];
  }

  private async getProject(projectId: string): Promise<any> {
    const result = await this.pool.query(
      'SELECT * FROM projects WHERE id = $1',
      [projectId]
    );
    return result.rows[0];
  }

  private async getTestSuite(testSuiteId: string): Promise<any> {
    const result = await this.pool.query(
      'SELECT * FROM test_suites WHERE id = $1',
      [testSuiteId]
    );
    return result.rows[0];
  }

  private async createAIJob(data: {
    project_id: string;
    task_id: string | null;
    provider: string;
    command: string;
    prompt: string;
    args: any;
  }): Promise<any> {
    // Include prompt in args JSONB field
    const argsWithPrompt = {
      ...data.args,
      prompt: data.prompt
    };

    const result = await this.pool.query(
      `INSERT INTO ai_jobs (project_id, task_id, provider, command, args, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        data.project_id,
        data.task_id,
        data.provider,
        data.command,
        JSON.stringify(argsWithPrompt),
        'pending'
      ]
    );
    return result.rows[0];
  }

  // ==========================================
  // EVENT EMISSION (SSE)
  // ==========================================

  private async emitProgressEvent(sessionId: string): Promise<void> {
    const budget = await this.retryStrategy.getBudgetTracking(sessionId);
    const tests = await this.retryStrategy.getTestRetryTracking(sessionId);
    const nextTest = await this.retryStrategy.getNextTestToRetry(sessionId);

    await this.pool.query(
      `INSERT INTO coding_session_events (session_id, event_type, payload)
       VALUES ($1, $2, $3)`,
      [
        sessionId,
        'retry_strategy_update',
        JSON.stringify({
          budget: {
            total: budget.total_budget,
            spent: budget.budget_spent,
            remaining: budget.budget_remaining,
            percentage_remaining: Math.round((budget.budget_remaining / budget.total_budget) * 100)
          },
          tests: {
            total: budget.total_tests,
            passing: budget.tests_passing,
            failing: budget.tests_failing,
            permanently_failed: budget.tests_permanently_failed,
            skipped: budget.tests_skipped,
            success_rate: Math.round((budget.tests_passing / budget.total_tests) * 100)
          },
          current_test: nextTest?.test_name,
          queue_length: tests.filter(t => t.status === 'failing').length
        })
      ]
    );
  }

  private async emitRetryAttemptEvent(sessionId: string, test: TestRetryTracking): Promise<void> {
    await this.pool.query(
      `INSERT INTO coding_session_events (session_id, event_type, payload)
       VALUES ($1, $2, $3)`,
      [
        sessionId,
        'test_retry_attempt',
        JSON.stringify({
          test_name: test.test_name,
          attempt_number: test.attempts + 1,
          max_attempts: test.max_attempts,
          complexity: test.complexity_level,
          retry_cost: test.retry_cost,
          priority_score: test.priority_score
        })
      ]
    );
  }

  private async emitTestRetryCompleteEvent(
    sessionId: string,
    test: TestRetryTracking,
    success: boolean,
    circuitBreakerTriggered: boolean
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO coding_session_events (session_id, event_type, payload)
       VALUES ($1, $2, $3)`,
      [
        sessionId,
        'test_retry_complete',
        JSON.stringify({
          test_name: test.test_name,
          success,
          attempts: test.attempts,
          status: test.status,
          circuit_breaker_triggered: circuitBreakerTriggered,
          error_message: test.error_history.length > 0
            ? test.error_history[test.error_history.length - 1].error_message
            : undefined
        })
      ]
    );
  }

  private async emitCompletionEvent(sessionId: string, report: any): Promise<void> {
    await this.pool.query(
      `INSERT INTO coding_session_events (session_id, event_type, payload)
       VALUES ($1, $2, $3)`,
      [
        sessionId,
        'retry_orchestration_complete',
        JSON.stringify({
          status: report.status,
          summary: report.summary,
          budget: report.budget,
          retry_stats: report.retry_stats,
          warnings: report.warnings,
          recommendations: report.recommendations
        })
      ]
    );
  }
}
