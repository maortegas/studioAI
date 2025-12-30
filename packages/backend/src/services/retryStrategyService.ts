/**
 * RetryStrategyService
 *
 * Implements the Hybrid Retry System for TDD cycle:
 * - Individual test retry tracking with budget management
 * - Complexity analysis and dynamic cost calculation
 * - Circuit breaker pattern for stuck tests
 * - Priority-based test ordering (ROI: impact/cost)
 */

import { Pool } from 'pg';
import * as crypto from 'crypto';
import {
  TestRetryTracking,
  RetryBudgetTracking,
  RetryExecutionLog,
  ComplexityAnalysis,
  ComplexityLevel,
  ErrorType,
  TestRetryStatus,
  RetryStrategy,
  RetryPlan,
  CompletionEvaluation,
  CompletionReport,
  CompletionStatus,
  ErrorHistoryEntry
} from '@devflow-studio/shared';

export class RetryStrategyService {
  private pool: Pool;

  constructor(pool?: Pool) {
    // Use provided pool or create new one
    this.pool = pool || new Pool({
      connectionString: process.env.DATABASE_URL
    });
  }

  // ==========================================
  // INITIALIZATION
  // ==========================================

  /**
   * Initialize retry strategy for a session with failed tests
   */
  async initializeRetryStrategy(
    sessionId: string,
    failedTests: Array<{ id: string; name: string; error_message?: string; test_code?: string }>
  ): Promise<RetryStrategy> {
    console.log(`[RetryStrategy] Initializing for session ${sessionId} with ${failedTests.length} failed tests`);

    // 1. Create budget tracking
    const budget = await this.createBudgetTracking(sessionId, failedTests.length);

    // 2. Analyze and create tracking for each test
    const tests: TestRetryTracking[] = [];
    for (const test of failedTests) {
      const complexity = await this.analyzeTestComplexity(test.test_code || '', test.error_message || '');
      const errorType = await this.detectErrorType(test.error_message || '');
      const cost = await this.calculateRetryCost(complexity.level);

      const tracking = await this.createTestRetryTracking({
        coding_session_id: sessionId,
        test_suite_id: test.id,
        test_name: test.name,
        complexity_level: complexity.level,
        error_type: errorType,
        retry_cost: cost,
        status: 'failing' as TestRetryStatus
      });

      tests.push(tracking);
    }

    // 3. Plan strategy
    const plan = await this.planRetryStrategy(sessionId);

    console.log(`[RetryStrategy] Initialized: ${tests.length} tests, budget: ${budget.total_budget} points, estimated cost: ${plan.estimated_cost}`);

    return {
      session_id: sessionId,
      budget,
      tests,
      queue: plan.queue,
      estimated_cost: plan.estimated_cost,
      estimated_success_rate: plan.estimated_success_rate
    };
  }

  // ==========================================
  // ANALYSIS
  // ==========================================

  /**
   * Analyze test complexity based on code and error message
   */
  async analyzeTestComplexity(testCode: string, errorMessage: string): Promise<ComplexityAnalysis> {
    const indicators = {
      simple: [
        /assertion failed/i,
        /expected.*but got/i,
        /toEqual/i,
        /toBe\(/i,
        /strict equal/i
      ],
      moderate: [
        /multiple assertions failed/i,
        /async.*timeout/i,
        /promise.*rejected/i,
        /callback.*not called/i
      ],
      complex: [
        /cannot find module/i,
        /dependency.*not found/i,
        /connection.*refused/i,
        /timeout exceeded/i,
        /stack overflow/i,
        /econnrefused/i,
        /network.*error/i
      ]
    };

    // Check error message against patterns
    for (const [level, patterns] of Object.entries(indicators)) {
      const matched = patterns.filter(pattern => pattern.test(errorMessage));
      if (matched.length > 0) {
        return {
          level: level as ComplexityLevel,
          confidence: 0.8,
          indicators_matched: matched
        };
      }
    }

    // Fallback: analyze test code complexity
    const linesOfCode = testCode.split('\n').length;
    const asyncOperations = (testCode.match(/await /g) || []).length;
    const mockOperations = (testCode.match(/mock|stub|spy/gi) || []).length;

    let level: ComplexityLevel;
    if (linesOfCode > 50 || asyncOperations > 3 || mockOperations > 2) {
      level = 'complex';
    } else if (linesOfCode > 20 || asyncOperations > 1) {
      level = 'moderate';
    } else {
      level = 'simple';
    }

    return {
      level,
      confidence: 0.6,
      analysis_details: {
        lines_of_code: linesOfCode,
        async_operations: asyncOperations,
        mock_operations: mockOperations
      }
    };
  }

  /**
   * Calculate retry cost based on complexity level
   */
  async calculateRetryCost(complexity: ComplexityLevel): Promise<number> {
    const costMap: Record<ComplexityLevel, number> = {
      simple: 1,
      moderate: 2,
      complex: 3
    };
    return costMap[complexity];
  }

  /**
   * Detect error type from error message
   */
  async detectErrorType(errorMessage: string): Promise<ErrorType> {
    const typePatterns: Record<ErrorType, RegExp[]> = {
      syntax: [
        /syntaxerror/i,
        /unexpected token/i,
        /parse error/i
      ],
      logic: [
        /assertion/i,
        /expected.*but/i,
        /toBe|toEqual|toMatch/i
      ],
      integration: [
        /cannot find module/i,
        /module.*not found/i,
        /import.*failed/i
      ],
      timeout: [
        /timeout/i,
        /exceeded.*time/i,
        /async.*timeout/i
      ],
      dependency: [
        /dependency/i,
        /not installed/i,
        /econnrefused/i,
        /connection.*refused/i
      ]
    };

    for (const [type, patterns] of Object.entries(typePatterns)) {
      if (patterns.some(pattern => pattern.test(errorMessage))) {
        return type as ErrorType;
      }
    }

    // Default: logic error (most common)
    return 'logic';
  }

  // ==========================================
  // PLANNING
  // ==========================================

  /**
   * Plan retry strategy: prioritize tests, check budget, mark low-priority
   */
  async planRetryStrategy(sessionId: string): Promise<RetryPlan> {
    // 1. Get all failing tests
    const failingTests = await this.getTestRetryTracking(sessionId, { status: 'failing' });

    // 2. Calculate priority score for each test
    const scoredTests = failingTests.map(test => {
      const priorityScore = this.calculatePriorityScore(test);
      return { ...test, priority_score: priorityScore };
    });

    // 3. Sort by priority (highest first)
    const orderedTests = scoredTests.sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0));

    // 4. Update priority scores in database
    for (const test of orderedTests) {
      await this.updateTestRetryTracking(test.id, { priority_score: test.priority_score });
    }

    // 5. Calculate if budget is sufficient
    const budget = await this.getBudgetTracking(sessionId);
    const totalCost = orderedTests.reduce((sum, test) => sum + (test.retry_cost * test.max_attempts), 0);

    let affordableTests = orderedTests;
    let lowPriorityTests: TestRetryTracking[] = [];

    // 6. Adjust strategy based on budget
    if (totalCost > budget.budget_remaining) {
      console.log(`[RetryStrategy] Total cost (${totalCost}) exceeds budget (${budget.budget_remaining}). Marking low-priority tests.`);

      const result = this.selectAffordableTests(orderedTests, budget.budget_remaining);
      affordableTests = result.affordable;
      lowPriorityTests = result.low_priority;

      // Mark low-priority tests in database
      for (const test of lowPriorityTests) {
        await this.updateTestRetryTracking(test.id, { status: 'low_priority' as TestRetryStatus });
      }
    }

    // 7. Calculate estimated success rate (heuristic based on complexity)
    const estimatedSuccessRate = this.calculateEstimatedSuccessRate(affordableTests);

    return {
      queue: affordableTests,
      estimated_cost: Math.min(totalCost, budget.budget_remaining),
      estimated_success_rate: estimatedSuccessRate,
      affordable_tests: affordableTests,
      low_priority_tests: lowPriorityTests
    };
  }

  /**
   * Calculate priority score (ROI: impact / cost)
   */
  private calculatePriorityScore(test: TestRetryTracking): number {
    // Impact factors
    const complexityImpact: Record<ComplexityLevel, number> = {
      simple: 1.0,    // High impact, usually easy fix
      moderate: 0.8,  // Medium impact, medium difficulty
      complex: 0.5    // Lower impact, harder fix
    };

    const errorTypeImpact: Record<ErrorType, number> = {
      syntax: 1.0,      // High impact, usually easy fix
      logic: 0.9,       // High impact, medium difficulty
      integration: 0.6, // Medium impact, harder fix
      timeout: 0.4,     // Low impact, often infrastructure
      dependency: 0.3   // Low impact, requires external changes
    };

    // Calculate impact
    const impact =
      ((test.complexity_level ? complexityImpact[test.complexity_level] : 0.5) * 0.5) +
      ((test.error_type ? errorTypeImpact[test.error_type] : 0.5) * 0.5);

    // Cost is the retry_cost (1-3 points)
    const cost = test.retry_cost;

    // Adjust for attempts already made (diminishing returns)
    const attemptsMultiplier = 1 / (test.attempts + 1);

    // ROI = (impact / cost) * diminishing_returns
    const roi = (impact / cost) * attemptsMultiplier;

    return Math.round(roi * 100) / 100; // Round to 2 decimals
  }

  /**
   * Select tests that fit within budget
   */
  private selectAffordableTests(
    tests: TestRetryTracking[],
    budget: number
  ): { affordable: TestRetryTracking[]; low_priority: TestRetryTracking[] } {
    const affordable: TestRetryTracking[] = [];
    const low_priority: TestRetryTracking[] = [];
    let remainingBudget = budget;

    for (const test of tests) {
      const maxCost = test.retry_cost * test.max_attempts;
      if (remainingBudget >= maxCost) {
        affordable.push(test);
        remainingBudget -= maxCost;
      } else {
        low_priority.push(test);
      }
    }

    return { affordable, low_priority };
  }

  /**
   * Calculate estimated success rate (heuristic)
   */
  private calculateEstimatedSuccessRate(tests: TestRetryTracking[]): number {
    if (tests.length === 0) return 0;

    const successProbabilities: Record<ComplexityLevel, number> = {
      simple: 0.9,
      moderate: 0.7,
      complex: 0.4
    };

    const totalProbability = tests.reduce((sum, test) => {
      const prob = test.complexity_level ? successProbabilities[test.complexity_level] : 0.6;
      return sum + prob;
    }, 0);

    return Math.round((totalProbability / tests.length) * 100) / 100;
  }

  // ==========================================
  // EXECUTION DECISION
  // ==========================================

  /**
   * Check if a test should be retried
   */
  async shouldRetryTest(testId: string): Promise<{ retry: boolean; reason: string }> {
    const test = await this.getTestRetryTrackingById(testId);

    if (!test) {
      return { retry: false, reason: 'Test not found' };
    }

    // Check 1: Circuit breaker active
    if (test.circuit_breaker_active) {
      return { retry: false, reason: 'Circuit breaker active (identical errors detected)' };
    }

    // Check 2: Max attempts reached
    if (test.attempts >= test.max_attempts) {
      return { retry: false, reason: `Max attempts (${test.max_attempts}) reached` };
    }

    // Check 3: Test already passing
    if (test.status === 'passing') {
      return { retry: false, reason: 'Test already passing' };
    }

    // Check 4: Test marked as low priority (budget insufficient)
    if (test.status === 'low_priority') {
      return { retry: false, reason: 'Test marked as low priority (budget insufficient)' };
    }

    // Check 5: Test permanently failed
    if (test.status === 'permanently_failed') {
      return { retry: false, reason: 'Test marked as permanently failed' };
    }

    // Check 6: Budget available
    const budgetRemaining = await this.getRemainingBudget(test.coding_session_id);
    if (budgetRemaining < test.retry_cost) {
      return { retry: false, reason: `Insufficient budget (need ${test.retry_cost}, have ${budgetRemaining})` };
    }

    return { retry: true, reason: 'Test eligible for retry' };
  }

  /**
   * Get next test to retry (highest priority, eligible)
   */
  async getNextTestToRetry(sessionId: string): Promise<TestRetryTracking | null> {
    const tests = await this.getTestRetryTracking(sessionId, { status: 'failing' });

    // Filter eligible tests
    const eligibleTests: TestRetryTracking[] = [];
    for (const test of tests) {
      const decision = await this.shouldRetryTest(test.id);
      if (decision.retry) {
        eligibleTests.push(test);
      }
    }

    if (eligibleTests.length === 0) {
      return null;
    }

    // Sort by priority (highest first)
    const sortedTests = eligibleTests.sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0));

    return sortedTests[0];
  }

  // ==========================================
  // BUDGET MANAGEMENT
  // ==========================================

  /**
   * Check if budget remaining is sufficient for cost
   */
  async hasBudgetRemaining(sessionId: string, cost: number): Promise<boolean> {
    const budget = await this.getBudgetTracking(sessionId);
    return budget.budget_remaining >= cost;
  }

  /**
   * Spend budget (deduct points)
   */
  async spendBudget(sessionId: string, cost: number): Promise<void> {
    await this.pool.query(
      `UPDATE retry_budget_tracking
       SET budget_spent = budget_spent + $1,
           budget_remaining = budget_remaining - $1,
           updated_at = NOW()
       WHERE coding_session_id = $2`,
      [cost, sessionId]
    );

    console.log(`[RetryStrategy] Spent ${cost} budget points for session ${sessionId}`);
  }

  /**
   * Get remaining budget
   */
  async getRemainingBudget(sessionId: string): Promise<number> {
    const budget = await this.getBudgetTracking(sessionId);
    return budget.budget_remaining;
  }

  // ==========================================
  // CIRCUIT BREAKER
  // ==========================================

  /**
   * Check circuit breaker: detect identical errors
   */
  async checkCircuitBreaker(testId: string, newError: string): Promise<boolean> {
    const test = await this.getTestRetryTrackingById(testId);
    if (!test) return false;

    const newErrorHash = this.hashError(newError);

    // First error for this test
    if (!test.last_error_hash) {
      await this.updateTestRetryTracking(testId, {
        last_error_hash: newErrorHash,
        consecutive_identical_errors: 1
      });
      await this.updateErrorHistory(testId, newError);
      return false;
    }

    // Same error as last time
    if (test.last_error_hash === newErrorHash) {
      const consecutiveCount = test.consecutive_identical_errors + 1;

      await this.updateTestRetryTracking(testId, {
        consecutive_identical_errors: consecutiveCount
      });
      await this.updateErrorHistory(testId, newError);

      // Trigger circuit breaker after 2 identical errors
      if (consecutiveCount >= 2) {
        console.warn(`[CircuitBreaker] Test ${test.test_name} failed with identical error ${consecutiveCount} times. Activating circuit breaker.`);
        await this.updateTestRetryTracking(testId, {
          circuit_breaker_active: true,
          status: 'skipped' as TestRetryStatus
        });
        return true;
      }
    } else {
      // Different error = progress! Reset counter
      console.log(`[CircuitBreaker] Test ${test.test_name} has different error (progress detected). Resetting counter.`);
      await this.updateTestRetryTracking(testId, {
        last_error_hash: newErrorHash,
        consecutive_identical_errors: 1
      });
      await this.updateErrorHistory(testId, newError);
    }

    return false;
  }

  /**
   * Update error history
   */
  async updateErrorHistory(testId: string, error: string): Promise<void> {
    const test = await this.getTestRetryTrackingById(testId);
    if (!test) return;

    const errorEntry: ErrorHistoryEntry = {
      attempt: test.attempts,
      error_message: error,
      error_hash: this.hashError(error),
      timestamp: new Date().toISOString()
    };

    const updatedHistory = [...test.error_history, errorEntry];

    await this.pool.query(
      `UPDATE test_retry_tracking
       SET error_history = $1::jsonb,
           updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(updatedHistory), testId]
    );
  }

  /**
   * Hash error message (MD5)
   */
  private hashError(error: string): string {
    return crypto.createHash('md5').update(error).digest('hex');
  }

  // ==========================================
  // COMPLETION EVALUATION
  // ==========================================

  /**
   * Evaluate if session should complete
   */
  async evaluateSessionCompletion(sessionId: string): Promise<CompletionEvaluation> {
    const budget = await this.getBudgetTracking(sessionId);
    const tests = await this.getTestRetryTracking(sessionId);

    // Condition 1: All tests passing
    if (budget.tests_failing === 0 && budget.tests_permanently_failed === 0) {
      return {
        should_complete: true,
        status: 'completed',
        reason: 'all_tests_passing',
        details: {
          passing_rate: 1.0
        }
      };
    }

    // Condition 2: Budget exhausted
    if (budget.budget_remaining === 0) {
      const passingRate = budget.tests_passing / budget.total_tests;

      if (passingRate >= 0.9) {
        return {
          should_complete: true,
          status: 'completed_with_warnings',
          reason: 'budget_exhausted_but_mostly_passing',
          details: {
            passing_rate: passingRate,
            budget_exhausted: true
          }
        };
      } else {
        return {
          should_complete: true,
          status: 'failed',
          reason: 'budget_exhausted_insufficient_passing',
          details: {
            passing_rate: passingRate,
            budget_exhausted: true
          }
        };
      }
    }

    // Condition 3: Too many permanently failed tests
    if (budget.tests_permanently_failed > budget.max_permanently_failed_threshold) {
      return {
        should_complete: true,
        status: 'failed',
        reason: 'too_many_permanently_failed_tests',
        details: {
          permanently_failed_count: budget.tests_permanently_failed
        }
      };
    }

    // Condition 4: No more tests to retry
    const retryableTests = tests.filter(
      t =>
        t.status === 'failing' &&
        t.attempts < t.max_attempts &&
        !t.circuit_breaker_active
    );

    if (retryableTests.length === 0) {
      const passingRate = budget.tests_passing / budget.total_tests;

      if (passingRate >= 0.8) {
        return {
          should_complete: true,
          status: 'completed_with_warnings',
          reason: 'no_more_retries_but_acceptable_passing_rate',
          details: {
            passing_rate: passingRate,
            retryable_tests_remaining: 0
          }
        };
      } else {
        return {
          should_complete: true,
          status: 'failed',
          reason: 'no_more_retries_insufficient_passing',
          details: {
            passing_rate: passingRate,
            retryable_tests_remaining: 0
          }
        };
      }
    }

    // Continue retrying
    return {
      should_complete: false,
      reason: 'retries_remaining',
      details: {
        retryable_tests_remaining: retryableTests.length
      }
    };
  }

  /**
   * Generate completion report
   */
  async generateCompletionReport(sessionId: string): Promise<CompletionReport> {
    const budget = await this.getBudgetTracking(sessionId);
    const tests = await this.getTestRetryTracking(sessionId);
    const logs = await this.getRetryExecutionLogs(sessionId);

    const successRate = budget.tests_passing / budget.total_tests;
    const utilizationRate = budget.budget_spent / budget.total_budget;

    const totalRetries = logs.length;
    const avgRetriesPerTest = tests.length > 0 ? totalRetries / tests.length : 0;
    const circuitBreakerTriggers = tests.filter(t => t.circuit_breaker_active).length;

    const failedTests = tests
      .filter(t => t.status === 'failing' || t.status === 'permanently_failed')
      .map(t => ({
        test_name: t.test_name,
        attempts: t.attempts,
        last_error: t.error_history.length > 0 ? t.error_history[t.error_history.length - 1].error_message : 'Unknown',
        status: t.status
      }));

    const warnings: string[] = [];
    const recommendations: string[] = [];

    // Generate warnings
    if (budget.tests_permanently_failed > 0) {
      warnings.push(`${budget.tests_permanently_failed} test(s) permanently failed after max attempts`);
    }
    if (circuitBreakerTriggers > 0) {
      warnings.push(`${circuitBreakerTriggers} test(s) triggered circuit breaker (identical errors)`);
    }
    if (budget.budget_remaining === 0) {
      warnings.push('Budget exhausted');
    }

    // Generate recommendations
    if (successRate < 0.8) {
      recommendations.push('Success rate below 80%. Consider reviewing test implementation or requirements.');
    }
    if (circuitBreakerTriggers > 0) {
      recommendations.push('Circuit breaker triggered. Review tests with identical errors - may require manual intervention.');
    }
    if (utilizationRate > 0.9) {
      recommendations.push('Budget utilization over 90%. Consider increasing budget for similar sessions.');
    }

    const evaluation = await this.evaluateSessionCompletion(sessionId);

    return {
      session_id: sessionId,
      status: evaluation.status || 'failed',
      summary: {
        total_tests: budget.total_tests,
        tests_passing: budget.tests_passing,
        tests_failing: budget.tests_failing,
        tests_permanently_failed: budget.tests_permanently_failed,
        tests_skipped: budget.tests_skipped,
        success_rate: Math.round(successRate * 100) / 100
      },
      budget: {
        total: budget.total_budget,
        spent: budget.budget_spent,
        remaining: budget.budget_remaining,
        utilization_rate: Math.round(utilizationRate * 100) / 100
      },
      retry_stats: {
        total_retries: totalRetries,
        average_retries_per_test: Math.round(avgRetriesPerTest * 100) / 100,
        circuit_breaker_triggers: circuitBreakerTriggers
      },
      failed_tests: failedTests.length > 0 ? failedTests : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
      recommendations: recommendations.length > 0 ? recommendations : undefined
    };
  }

  // ==========================================
  // DATABASE OPERATIONS
  // ==========================================

  /**
   * Create budget tracking entry
   */
  private async createBudgetTracking(sessionId: string, totalTests: number): Promise<RetryBudgetTracking> {
    const result = await this.pool.query(
      `INSERT INTO retry_budget_tracking (
        coding_session_id, total_budget, budget_spent, budget_remaining,
        total_tests, tests_passing, tests_failing, tests_permanently_failed, tests_skipped,
        max_permanently_failed_threshold, strategy_phase
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [sessionId, 15, 0, 15, totalTests, 0, totalTests, 0, 0, 2, 'planning']
    );
    return result.rows[0];
  }

  /**
   * Get budget tracking
   */
  async getBudgetTracking(sessionId: string): Promise<RetryBudgetTracking> {
    const result = await this.pool.query(
      'SELECT * FROM retry_budget_tracking WHERE coding_session_id = $1',
      [sessionId]
    );
    if (result.rows.length === 0) {
      throw new Error(`Budget tracking not found for session ${sessionId}`);
    }
    return result.rows[0];
  }

  /**
   * Update budget tracking
   */
  async updateBudgetTracking(sessionId: string, updates: Partial<RetryBudgetTracking>): Promise<void> {
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (key !== 'id' && key !== 'coding_session_id' && key !== 'created_at') {
        setClauses.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (setClauses.length === 0) return;

    values.push(sessionId);
    await this.pool.query(
      `UPDATE retry_budget_tracking
       SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE coding_session_id = $${paramIndex}`,
      values
    );
  }

  /**
   * Create test retry tracking entry
   */
  private async createTestRetryTracking(data: {
    coding_session_id: string;
    test_suite_id: string;
    test_name: string;
    complexity_level?: ComplexityLevel;
    error_type?: ErrorType;
    retry_cost: number;
    status: TestRetryStatus;
  }): Promise<TestRetryTracking> {
    const result = await this.pool.query(
      `INSERT INTO test_retry_tracking (
        coding_session_id, test_suite_id, test_name, complexity_level,
        error_type, retry_cost, status, attempts, max_attempts,
        consecutive_identical_errors, circuit_breaker_active, error_history
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        data.coding_session_id,
        data.test_suite_id,
        data.test_name,
        data.complexity_level || null,
        data.error_type || null,
        data.retry_cost,
        data.status,
        0, // attempts
        3, // max_attempts
        0, // consecutive_identical_errors
        false, // circuit_breaker_active
        JSON.stringify([]) // error_history
      ]
    );
    return this.parseTestRetryTracking(result.rows[0]);
  }

  /**
   * Get test retry tracking entries
   */
  async getTestRetryTracking(
    sessionId: string,
    filter?: { status?: TestRetryStatus }
  ): Promise<TestRetryTracking[]> {
    let query = 'SELECT * FROM test_retry_tracking WHERE coding_session_id = $1';
    const values: any[] = [sessionId];

    if (filter?.status) {
      query += ' AND status = $2';
      values.push(filter.status);
    }

    query += ' ORDER BY priority_score DESC NULLS LAST';

    const result = await this.pool.query(query, values);
    return result.rows.map(row => this.parseTestRetryTracking(row));
  }

  /**
   * Get test retry tracking by ID
   */
  async getTestRetryTrackingById(testId: string): Promise<TestRetryTracking | null> {
    const result = await this.pool.query(
      'SELECT * FROM test_retry_tracking WHERE id = $1',
      [testId]
    );
    if (result.rows.length === 0) return null;
    return this.parseTestRetryTracking(result.rows[0]);
  }

  /**
   * Update test retry tracking
   */
  async updateTestRetryTracking(testId: string, updates: Partial<TestRetryTracking>): Promise<void> {
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (key !== 'id' && key !== 'coding_session_id' && key !== 'test_suite_id' && key !== 'created_at') {
        setClauses.push(`${key} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (setClauses.length === 0) return;

    values.push(testId);
    await this.pool.query(
      `UPDATE test_retry_tracking
       SET ${setClauses.join(', ')}
       WHERE id = $${paramIndex}`,
      values
    );
  }

  /**
   * Increment test attempts counter
   */
  async incrementTestAttempts(testId: string): Promise<void> {
    await this.pool.query(
      `UPDATE test_retry_tracking
       SET attempts = attempts + 1,
           last_attempt_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [testId]
    );
  }

  /**
   * Create retry execution log entry
   */
  async createRetryExecutionLog(data: Partial<RetryExecutionLog>): Promise<RetryExecutionLog> {
    const result = await this.pool.query(
      `INSERT INTO retry_execution_log (
        coding_session_id, test_retry_tracking_id, attempt_number, budget_cost,
        ai_job_id, decision_reason, priority_score, files_modified
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        data.coding_session_id,
        data.test_retry_tracking_id || null,
        data.attempt_number,
        data.budget_cost,
        data.ai_job_id || null,
        data.decision_reason || null,
        data.priority_score || null,
        JSON.stringify(data.files_modified || [])
      ]
    );
    return this.parseRetryExecutionLog(result.rows[0]);
  }

  /**
   * Update retry execution log
   */
  async updateRetryExecutionLog(logId: string, updates: Partial<RetryExecutionLog>): Promise<void> {
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (key !== 'id' && key !== 'coding_session_id' && key !== 'started_at') {
        if (key === 'files_modified') {
          setClauses.push(`${key} = $${paramIndex}::jsonb`);
          values.push(JSON.stringify(value));
        } else {
          setClauses.push(`${key} = $${paramIndex}`);
          values.push(value);
        }
        paramIndex++;
      }
    }

    if (setClauses.length === 0) return;

    values.push(logId);
    await this.pool.query(
      `UPDATE retry_execution_log
       SET ${setClauses.join(', ')}
       WHERE id = $${paramIndex}`,
      values
    );
  }

  /**
   * Get retry execution logs for session
   */
  async getRetryExecutionLogs(sessionId: string): Promise<RetryExecutionLog[]> {
    const result = await this.pool.query(
      'SELECT * FROM retry_execution_log WHERE coding_session_id = $1 ORDER BY started_at ASC',
      [sessionId]
    );
    return result.rows.map(row => this.parseRetryExecutionLog(row));
  }

  /**
   * Parse TestRetryTracking from database row
   */
  private parseTestRetryTracking(row: any): TestRetryTracking {
    return {
      ...row,
      error_history: typeof row.error_history === 'string' ? JSON.parse(row.error_history) : row.error_history
    };
  }

  /**
   * Parse RetryExecutionLog from database row
   */
  private parseRetryExecutionLog(row: any): RetryExecutionLog {
    return {
      ...row,
      files_modified: typeof row.files_modified === 'string' ? JSON.parse(row.files_modified) : row.files_modified
    };
  }
}
