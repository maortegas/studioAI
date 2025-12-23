-- Migration: Add 'reviewing' status to coding_sessions
-- This allows coding sessions to be in a 'reviewing' state when code review is in progress

-- Drop the existing constraint
ALTER TABLE coding_sessions DROP CONSTRAINT IF EXISTS coding_sessions_status_check;

-- Add the new constraint with 'reviewing' status included
ALTER TABLE coding_sessions 
  ADD CONSTRAINT coding_sessions_status_check 
  CHECK (status IN ('pending', 'running', 'completed', 'failed', 'paused', 'reviewing', 'generating_tests', 'tests_generated'));

