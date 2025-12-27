-- Migration: Add 'tdd_ready' and 'tdd_implementing' statuses to coding_sessions
-- These statuses are used by the TDD Context Management System
-- 'tdd_ready': Context files created, ready for implementation
-- 'tdd_implementing': All-at-once implementation in progress

-- Drop the existing constraint
ALTER TABLE coding_sessions DROP CONSTRAINT IF EXISTS coding_sessions_status_check;

-- Add the new constraint with TDD context management statuses included
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
    'tdd_implementing'  -- All-at-once implementation in progress
  ));

