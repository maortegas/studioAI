-- Migration: Add TDD cycle support to coding_sessions
-- This adds the tdd_cycle JSONB field to track Red-Green-Refactor cycle state
-- and adds new status values for TDD phases

-- ============================================
-- Step 1: Add tdd_cycle JSONB column
-- ============================================
ALTER TABLE coding_sessions 
  ADD COLUMN IF NOT EXISTS tdd_cycle JSONB;

-- ============================================
-- Step 2: Update status CHECK constraint to include TDD phases
-- ============================================
-- Drop the existing constraint
ALTER TABLE coding_sessions DROP CONSTRAINT IF EXISTS coding_sessions_status_check;

-- Add the new constraint with TDD phase statuses included
ALTER TABLE coding_sessions 
  ADD CONSTRAINT coding_sessions_status_check 
  CHECK (status IN (
    'pending', 
    'running', 
    'completed', 
    'failed', 
    'paused', 
    'reviewing', 
    'generating_tests', 
    'tests_generated',
    'tdd_red',      -- RED phase: Test is failing (expected)
    'tdd_green',   -- GREEN phase: Implementing minimal code to pass test
    'tdd_refactor' -- REFACTOR phase: Improving code while keeping tests passing
  ));

-- ============================================
-- Step 3: Create GIN index for efficient JSONB queries
-- ============================================
-- This index allows fast queries on tdd_cycle JSONB field
-- Useful for filtering sessions by test_index, phase, etc.
CREATE INDEX IF NOT EXISTS idx_coding_sessions_tdd_cycle 
  ON coding_sessions USING GIN (tdd_cycle);

-- ============================================
-- Step 4: Add comment for documentation
-- ============================================
COMMENT ON COLUMN coding_sessions.tdd_cycle IS 
  'TDD cycle state: {test_index, phase, current_test, current_test_name, tests_passed, total_tests, all_tests[], refactor_count, stuck_count}';

