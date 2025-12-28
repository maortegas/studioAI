-- Add 'tdd_refactoring' status to coding_sessions status CHECK constraint
-- Migration 016: Support automatic TDD refactoring cycle
-- This adds 'tdd_refactoring' to the existing status values from migration 013

-- Drop the old constraint
ALTER TABLE coding_sessions 
  DROP CONSTRAINT IF EXISTS coding_sessions_status_check;

-- Add new constraint with all statuses including 'tdd_refactoring'
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
    'tdd_green',        -- GREEN phase: Implementing code to pass tests (batch)
    'tdd_refactor',     -- REFACTOR phase: Strategic refactoring at key points
    'tdd_ready',        -- Context files created, ready for implementation
    'tdd_implementing', -- All-at-once implementation in progress
    'tdd_refactoring'   -- Automatic refactoring cycle after test failures
  ));

