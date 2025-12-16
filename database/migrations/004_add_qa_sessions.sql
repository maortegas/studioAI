-- Create qa_sessions table for tracking automated QA runs
CREATE TABLE IF NOT EXISTS qa_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  coding_session_id UUID REFERENCES coding_sessions(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  total_tests INTEGER NOT NULL DEFAULT 0,
  passed_tests INTEGER NOT NULL DEFAULT 0,
  failed_tests INTEGER NOT NULL DEFAULT 0,
  skipped_tests INTEGER NOT NULL DEFAULT 0,
  coverage_percentage DECIMAL(5,2),
  report_path TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create test_results table for individual test outcomes
CREATE TABLE IF NOT EXISTS test_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES qa_sessions(id) ON DELETE CASCADE,
  test_name VARCHAR(255) NOT NULL,
  test_type VARCHAR(20) NOT NULL CHECK (test_type IN ('unit', 'integration', 'e2e', 'performance', 'security')),
  status VARCHAR(20) NOT NULL CHECK (status IN ('passed', 'failed', 'skipped', 'error')),
  duration INTEGER, -- milliseconds
  error_message TEXT,
  stack_trace TEXT,
  output TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_qa_sessions_project_id ON qa_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_qa_sessions_coding_session_id ON qa_sessions(coding_session_id);
CREATE INDEX IF NOT EXISTS idx_qa_sessions_status ON qa_sessions(status);
CREATE INDEX IF NOT EXISTS idx_test_results_session_id ON test_results(session_id);
CREATE INDEX IF NOT EXISTS idx_test_results_status ON test_results(status);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_qa_session_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_qa_session_updated_at
  BEFORE UPDATE ON qa_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_qa_session_updated_at();
