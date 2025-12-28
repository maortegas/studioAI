-- Extend coding_session_events event_type to include new TDD and test execution events
-- Migration 015: Add new event types for real-time TDD progress visibility

-- Drop the old constraint
ALTER TABLE coding_session_events 
  DROP CONSTRAINT IF EXISTS coding_session_events_event_type_check;

-- Add new constraint with all event types
ALTER TABLE coding_session_events 
  ADD CONSTRAINT coding_session_events_event_type_check 
  CHECK (event_type IN (
    'progress',
    'file_change',
    'output',
    'error',
    'completed',
    'tests_generated',
    'implementation_started',
    'test_execution_result',
    'tdd_batch_completed',
    'tdd_cycle_progress',
    'test_execution_summary'
  ));

