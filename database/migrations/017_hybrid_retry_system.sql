-- Migration 017: Hybrid Retry System
-- Implements individual test retry tracking with budget management and circuit breaker

-- Table: test_retry_tracking
-- Tracks retry attempts for individual tests with complexity analysis and circuit breaker
CREATE TABLE IF NOT EXISTS test_retry_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coding_session_id UUID NOT NULL REFERENCES coding_sessions(id) ON DELETE CASCADE,
  test_suite_id UUID NOT NULL REFERENCES test_suites(id) ON DELETE CASCADE,

  -- Test metadata
  test_name VARCHAR(500) NOT NULL,

  -- Retry tracking
  attempts INT DEFAULT 0,
  max_attempts INT DEFAULT 3,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  -- Status values: 'pending', 'passing', 'failing', 'permanently_failed', 'skipped', 'low_priority'

  -- Complexity analysis
  complexity_level VARCHAR(20), -- 'simple', 'moderate', 'complex'
  error_type VARCHAR(50), -- 'syntax', 'logic', 'integration', 'timeout', 'dependency'
  retry_cost INT DEFAULT 1, -- Budget points (1-3)

  -- Circuit breaker
  consecutive_identical_errors INT DEFAULT 0,
  last_error_hash VARCHAR(64), -- MD5 of error message
  circuit_breaker_active BOOLEAN DEFAULT false,

  -- Error history (JSON array of error objects)
  error_history JSONB DEFAULT '[]'::jsonb,

  -- Priority scoring
  priority_score DECIMAL(5,2),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ,

  UNIQUE(coding_session_id, test_suite_id)
);

CREATE INDEX idx_retry_tracking_session ON test_retry_tracking(coding_session_id);
CREATE INDEX idx_retry_tracking_status ON test_retry_tracking(status);
CREATE INDEX idx_retry_tracking_priority ON test_retry_tracking(priority_score DESC);

-- Table: retry_budget_tracking
-- Tracks retry budget and overall strategy state for a coding session
CREATE TABLE IF NOT EXISTS retry_budget_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coding_session_id UUID NOT NULL UNIQUE REFERENCES coding_sessions(id) ON DELETE CASCADE,

  -- Budget management
  total_budget INT DEFAULT 15,
  budget_spent INT DEFAULT 0,
  budget_remaining INT DEFAULT 15,

  -- Strategy stats
  total_tests INT DEFAULT 0,
  tests_passing INT DEFAULT 0,
  tests_failing INT DEFAULT 0,
  tests_permanently_failed INT DEFAULT 0,
  tests_skipped INT DEFAULT 0,

  -- Thresholds
  max_permanently_failed_threshold INT DEFAULT 2,

  -- State
  strategy_phase VARCHAR(50) DEFAULT 'planning',
  -- Phases: 'planning', 'executing', 'completed', 'budget_exhausted', 'failed'

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_budget_tracking_session ON retry_budget_tracking(coding_session_id);
CREATE INDEX idx_budget_tracking_phase ON retry_budget_tracking(strategy_phase);

-- Table: retry_execution_log
-- Logs each individual retry attempt with detailed results
CREATE TABLE IF NOT EXISTS retry_execution_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coding_session_id UUID NOT NULL REFERENCES coding_sessions(id) ON DELETE CASCADE,
  test_retry_tracking_id UUID REFERENCES test_retry_tracking(id) ON DELETE CASCADE,

  -- Execution details
  attempt_number INT NOT NULL,
  budget_cost INT NOT NULL,

  -- AI job reference
  ai_job_id UUID REFERENCES ai_jobs(id),

  -- Results
  success BOOLEAN,
  error_message TEXT,
  error_hash VARCHAR(64),
  test_output TEXT,

  -- Changes made (JSON array of file paths)
  files_modified JSONB DEFAULT '[]'::jsonb,

  -- Timing
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INT,

  -- Decision tracking
  decision_reason TEXT, -- Why this test was retried at this time
  priority_score DECIMAL(5,2) -- impact/cost ratio used for ordering
);

CREATE INDEX idx_retry_log_session ON retry_execution_log(coding_session_id);
CREATE INDEX idx_retry_log_test ON retry_execution_log(test_retry_tracking_id);
CREATE INDEX idx_retry_log_attempt ON retry_execution_log(attempt_number);

-- Add trigger to update updated_at on test_retry_tracking
CREATE OR REPLACE FUNCTION update_test_retry_tracking_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_test_retry_tracking_timestamp
BEFORE UPDATE ON test_retry_tracking
FOR EACH ROW
EXECUTE FUNCTION update_test_retry_tracking_timestamp();

-- Add trigger to update updated_at on retry_budget_tracking
CREATE TRIGGER trigger_update_retry_budget_tracking_timestamp
BEFORE UPDATE ON retry_budget_tracking
FOR EACH ROW
EXECUTE FUNCTION update_test_retry_tracking_timestamp();

-- Migration note: This system replaces the global refactor_attempts counter
-- with per-test tracking and budget management
