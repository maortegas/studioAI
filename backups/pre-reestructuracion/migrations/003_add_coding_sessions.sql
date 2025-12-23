-- Create coding_sessions table for tracking implementation work
CREATE TABLE IF NOT EXISTS coding_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  story_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  programmer_type VARCHAR(20) NOT NULL CHECK (programmer_type IN ('backend', 'frontend', 'fullstack')),
  ai_job_id UUID REFERENCES ai_jobs(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'paused')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  current_file TEXT,
  output TEXT,
  error TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_coding_sessions_project_id ON coding_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_coding_sessions_story_id ON coding_sessions(story_id);
CREATE INDEX IF NOT EXISTS idx_coding_sessions_status ON coding_sessions(status);
CREATE INDEX IF NOT EXISTS idx_coding_sessions_ai_job_id ON coding_sessions(ai_job_id);

-- Create coding_session_events table for real-time event streaming
CREATE TABLE IF NOT EXISTS coding_session_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES coding_sessions(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('progress', 'file_change', 'output', 'error', 'completed')),
  payload JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create index for event queries
CREATE INDEX IF NOT EXISTS idx_coding_session_events_session_id ON coding_session_events(session_id);
CREATE INDEX IF NOT EXISTS idx_coding_session_events_created_at ON coding_session_events(created_at);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_coding_session_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_coding_session_updated_at
  BEFORE UPDATE ON coding_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_coding_session_updated_at();
