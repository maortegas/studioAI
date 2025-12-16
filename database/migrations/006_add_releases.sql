-- Create releases table for version management
CREATE TABLE IF NOT EXISTS releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'published', 'archived')),
  title TEXT,
  description TEXT,
  changelog TEXT,
  release_notes TEXT,
  git_tag VARCHAR(255),
  release_date TIMESTAMP,
  created_by VARCHAR(255),
  artifacts JSONB, -- Array of artifact IDs or paths included in this release
  metadata JSONB, -- Additional metadata (build info, dependencies, etc.)
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, version)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_releases_project_id ON releases(project_id);
CREATE INDEX IF NOT EXISTS idx_releases_status ON releases(status);
CREATE INDEX IF NOT EXISTS idx_releases_version ON releases(version);
CREATE INDEX IF NOT EXISTS idx_releases_release_date ON releases(release_date);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_release_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_release_updated_at
  BEFORE UPDATE ON releases
  FOR EACH ROW
  EXECUTE FUNCTION update_release_updated_at();
