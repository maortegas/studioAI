-- Migration: Add 'user_instructions' event type to coding_session_events
-- Date: 2025-12-31
-- Purpose: Allow storing user instructions when retrying failed sessions

-- Drop existing constraint
ALTER TABLE coding_session_events
DROP CONSTRAINT IF EXISTS coding_session_events_event_type_check;

-- Add new constraint with 'user_instructions' included
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
  'test_execution_summary',
  'test_retry_attempt',
  'test_retry_complete',
  'retry_strategy_update',
  'circuit_breaker_triggered',
  'budget_exhausted',
  'retry_orchestration_complete',
  'user_instructions'  -- NEW: For retry-with-instructions feature
));
