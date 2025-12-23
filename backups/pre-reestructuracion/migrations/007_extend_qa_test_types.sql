-- Migration: Extend QA to support multiple test types (unit, integration, e2e, contract, load)
-- Add test_type column to qa_sessions table
ALTER TABLE qa_sessions 
ADD COLUMN IF NOT EXISTS test_type VARCHAR(20) CHECK (test_type IN ('unit', 'integration', 'e2e', 'contract', 'load'));

-- Update test_results to include new test types
ALTER TABLE test_results 
DROP CONSTRAINT IF EXISTS test_results_test_type_check;

ALTER TABLE test_results 
ADD CONSTRAINT test_results_test_type_check 
CHECK (test_type IN ('unit', 'integration', 'e2e', 'contract', 'load', 'performance', 'security'));

-- Create index for test_type in qa_sessions for faster filtering
CREATE INDEX IF NOT EXISTS idx_qa_sessions_test_type ON qa_sessions(test_type);

-- Create index for test_type in test_results
CREATE INDEX IF NOT EXISTS idx_test_results_test_type ON test_results(test_type);
