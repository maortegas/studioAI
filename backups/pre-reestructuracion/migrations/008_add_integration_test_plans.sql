-- Migration: Add test plans table (for all test types)
-- Create test_plans table for storing test plans before execution
CREATE TABLE IF NOT EXISTS test_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  qa_session_id UUID REFERENCES qa_sessions(id) ON DELETE SET NULL,
  coding_session_id UUID REFERENCES coding_sessions(id) ON DELETE SET NULL,
  test_type VARCHAR(20) NOT NULL CHECK (test_type IN ('unit', 'integration', 'e2e', 'contract', 'load')),
  items JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of TestPlanItem
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'executing', 'completed')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_test_plans_project_id ON test_plans(project_id);
CREATE INDEX IF NOT EXISTS idx_test_plans_qa_session_id ON test_plans(qa_session_id);
CREATE INDEX IF NOT EXISTS idx_test_plans_coding_session_id ON test_plans(coding_session_id);
CREATE INDEX IF NOT EXISTS idx_test_plans_test_type ON test_plans(test_type);
CREATE INDEX IF NOT EXISTS idx_test_plans_status ON test_plans(status);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_test_plan_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_test_plan_updated_at
  BEFORE UPDATE ON test_plans
  FOR EACH ROW
  EXECUTE FUNCTION update_test_plan_updated_at();

-- Legacy table name for backward compatibility (if needed)
CREATE TABLE IF NOT EXISTS integration_test_plans (
  LIKE test_plans INCLUDING ALL
);
