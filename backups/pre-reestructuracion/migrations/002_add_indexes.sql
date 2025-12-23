-- Indexes for projects
CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);
CREATE INDEX IF NOT EXISTS idx_projects_base_path ON projects(base_path);

-- Indexes for artifacts
CREATE INDEX IF NOT EXISTS idx_artifacts_project_id ON artifacts(project_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_type ON artifacts(type);
CREATE INDEX IF NOT EXISTS idx_artifacts_project_type ON artifacts(project_id, type);

-- Indexes for tasks
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);
CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status);

-- Indexes for runs
CREATE INDEX IF NOT EXISTS idx_runs_task_id ON runs(task_id);
CREATE INDEX IF NOT EXISTS idx_runs_provider ON runs(provider);
CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at);

-- Indexes for ai_jobs
CREATE INDEX IF NOT EXISTS idx_ai_jobs_project_id ON ai_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_task_id ON ai_jobs(task_id);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_status ON ai_jobs(status);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_created_at ON ai_jobs(created_at);

-- Indexes for ai_job_events
CREATE INDEX IF NOT EXISTS idx_ai_job_events_job_id ON ai_job_events(job_id);
CREATE INDEX IF NOT EXISTS idx_ai_job_events_event_type ON ai_job_events(event_type);
CREATE INDEX IF NOT EXISTS idx_ai_job_events_created_at ON ai_job_events(created_at);

