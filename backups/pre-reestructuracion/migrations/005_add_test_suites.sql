-- Create test_suites table for structured test management
CREATE TABLE IF NOT EXISTS test_suites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  coding_session_id UUID REFERENCES coding_sessions(id) ON DELETE SET NULL,
  story_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  test_type VARCHAR(50) NOT NULL CHECK (test_type IN ('unit', 'integration', 'e2e', 'performance', 'security')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generating', 'ready', 'running', 'passed', 'failed', 'skipped')),
  file_path TEXT,
  test_code TEXT,
  generated_at TIMESTAMP,
  executed_at TIMESTAMP,
  execution_result JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create test_executions table for tracking test runs
CREATE TABLE IF NOT EXISTS test_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_suite_id UUID NOT NULL REFERENCES test_suites(id) ON DELETE CASCADE,
  execution_type VARCHAR(50) NOT NULL CHECK (execution_type IN ('auto', 'manual', 'ci')),
  status VARCHAR(20) NOT NULL CHECK (status IN ('running', 'passed', 'failed', 'skipped', 'error')),
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  duration INTEGER, -- milliseconds
  total_tests INTEGER DEFAULT 0,
  passed_tests INTEGER DEFAULT 0,
  failed_tests INTEGER DEFAULT 0,
  skipped_tests INTEGER DEFAULT 0,
  output TEXT,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_test_suites_project_id ON test_suites(project_id);
CREATE INDEX IF NOT EXISTS idx_test_suites_coding_session_id ON test_suites(coding_session_id);
CREATE INDEX IF NOT EXISTS idx_test_suites_story_id ON test_suites(story_id);
CREATE INDEX IF NOT EXISTS idx_test_suites_status ON test_suites(status);
CREATE INDEX IF NOT EXISTS idx_test_executions_test_suite_id ON test_executions(test_suite_id);
CREATE INDEX IF NOT EXISTS idx_test_executions_status ON test_executions(status);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_test_suite_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_test_suite_updated_at
  BEFORE UPDATE ON test_suites
  FOR EACH ROW
  EXECUTE FUNCTION update_test_suite_updated_at();
