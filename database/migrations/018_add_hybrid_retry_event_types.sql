-- Migration 018: Add Hybrid Retry System Event Types
-- Adds new event types for hybrid retry system to coding_session_events constraint

-- Drop the existing constraint
ALTER TABLE coding_session_events
DROP CONSTRAINT IF EXISTS coding_session_events_event_type_check;

-- Add the constraint with new event types
ALTER TABLE coding_session_events
ADD CONSTRAINT coding_session_events_event_type_check
CHECK (event_type IN (
  -- Existing event types
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

  -- New hybrid retry system event types
  'test_retry_attempt',
  'test_retry_complete',
  'retry_strategy_update',
  'circuit_breaker_triggered',
  'budget_exhausted',
  'retry_orchestration_complete'
));
