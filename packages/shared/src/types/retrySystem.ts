/**
 * TypeScript types for Hybrid Retry System
 * Supports individual test retry tracking with budget management and circuit breaker
 */

export type ComplexityLevel = 'simple' | 'moderate' | 'complex';

export type ErrorType = 'syntax' | 'logic' | 'integration' | 'timeout' | 'dependency';

export type TestRetryStatus =
  | 'pending'
  | 'passing'
  | 'failing'
  | 'permanently_failed'
  | 'skipped'
  | 'low_priority';

export type StrategyPhase =
  | 'planning'
  | 'executing'
  | 'completed'
  | 'budget_exhausted'
  | 'failed';

export type CompletionStatus =
  | 'completed'
  | 'completed_with_warnings'
  | 'failed';

export interface TestRetryTracking {
  id: string;
  coding_session_id: string;
  test_suite_id: string;

  // Test metadata
  test_name: string;

  // Retry tracking
  attempts: number;
  max_attempts: number;
  status: TestRetryStatus;

  // Complexity analysis
  complexity_level?: ComplexityLevel;
  error_type?: ErrorType;
  retry_cost: number; // Budget points (1-3)

  // Circuit breaker
  consecutive_identical_errors: number;
  last_error_hash?: string;
  circuit_breaker_active: boolean;

  // Error history
  error_history: ErrorHistoryEntry[];

  // Priority scoring
  priority_score?: number;

  // Timestamps
  created_at: Date;
  updated_at: Date;
  last_attempt_at?: Date;
}

export interface ErrorHistoryEntry {
  attempt: number;
  error_message: string;
  error_hash: string;
  timestamp: string;
}

export interface RetryBudgetTracking {
  id: string;
  coding_session_id: string;

  // Budget management
  total_budget: number;
  budget_spent: number;
  budget_remaining: number;

  // Strategy stats
  total_tests: number;
  tests_passing: number;
  tests_failing: number;
  tests_permanently_failed: number;
  tests_skipped: number;

  // Thresholds
  max_permanently_failed_threshold: number;

  // State
  strategy_phase: StrategyPhase;

  // Metadata
  created_at: Date;
  updated_at: Date;
}

export interface RetryExecutionLog {
  id: string;
  coding_session_id: string;
  test_retry_tracking_id?: string;

  // Execution details
  attempt_number: number;
  budget_cost: number;

  // AI job reference
  ai_job_id?: string;

  // Results
  success?: boolean;
  error_message?: string;
  error_hash?: string;
  test_output?: string;

  // Changes made
  files_modified: string[];

  // Timing
  started_at: Date;
  completed_at?: Date;
  duration_ms?: number;

  // Decision tracking
  decision_reason?: string;
  priority_score?: number;
}

export interface ComplexityAnalysis {
  level: ComplexityLevel;
  confidence: number; // 0.0 - 1.0
  indicators_matched?: RegExp[];
  analysis_details?: {
    lines_of_code?: number;
    async_operations?: number;
    mock_operations?: number;
  };
}

export interface RetryStrategy {
  session_id: string;
  budget: RetryBudgetTracking;
  tests: TestRetryTracking[];
  queue: TestRetryTracking[]; // Ordered by priority
  estimated_cost: number;
  estimated_success_rate: number;
}

export interface RetryPlan {
  queue: TestRetryTracking[]; // Tests to retry, ordered by priority
  estimated_cost: number;
  estimated_success_rate: number;
  affordable_tests: TestRetryTracking[];
  low_priority_tests: TestRetryTracking[];
}

export interface RetryResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  ai_job_id?: string;
  error?: string;
}

export interface CompletionEvaluation {
  should_complete: boolean;
  status?: CompletionStatus;
  reason: string;
  details?: {
    passing_rate?: number;
    budget_exhausted?: boolean;
    permanently_failed_count?: number;
    retryable_tests_remaining?: number;
  };
}

export interface CompletionReport {
  session_id: string;
  status: CompletionStatus;
  summary: {
    total_tests: number;
    tests_passing: number;
    tests_failing: number;
    tests_permanently_failed: number;
    tests_skipped: number;
    success_rate: number;
  };
  budget: {
    total: number;
    spent: number;
    remaining: number;
    utilization_rate: number;
  };
  retry_stats: {
    total_retries: number;
    average_retries_per_test: number;
    circuit_breaker_triggers: number;
  };
  failed_tests?: Array<{
    test_name: string;
    attempts: number;
    last_error: string;
    status: TestRetryStatus;
  }>;
  warnings?: string[];
  recommendations?: string[];
}

export interface OrchestrationResult {
  session_id: string;
  completed: boolean;
  status: CompletionStatus;
  tests_processed: number;
  budget_spent: number;
  duration_ms: number;
  report: CompletionReport;
}

// Event payloads for SSE
export interface RetryStrategyUpdatePayload {
  budget: {
    total: number;
    spent: number;
    remaining: number;
    percentage_remaining: number;
  };
  tests: {
    total: number;
    passing: number;
    failing: number;
    permanently_failed: number;
    skipped: number;
    success_rate: number;
  };
  current_test?: string;
  queue_length: number;
  estimated_completion?: string;
}

export interface TestRetryAttemptPayload {
  test_name: string;
  attempt_number: number;
  max_attempts: number;
  complexity: ComplexityLevel;
  retry_cost: number;
  priority_score: number;
}

export interface TestRetryCompletePayload {
  test_name: string;
  success: boolean;
  attempts: number;
  status: TestRetryStatus;
  error_message?: string;
  circuit_breaker_triggered?: boolean;
}

export interface BudgetExhaustedPayload {
  budget_spent: number;
  tests_passing: number;
  tests_failing: number;
  completion_status: CompletionStatus;
}

// Configuration
export interface RetrySystemConfig {
  total_budget: number; // Default: 15
  max_attempts_per_test: number; // Default: 3
  max_permanently_failed_threshold: number; // Default: 2
  circuit_breaker_threshold: number; // Default: 2 (identical errors)
  enable_hybrid_retry: boolean; // Feature flag
}
