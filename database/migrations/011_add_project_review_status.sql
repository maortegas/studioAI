-- Migration: Add review_status column to projects table
-- This stores the current review status for project-wide reviews

ALTER TABLE projects 
  ADD COLUMN IF NOT EXISTS review_status JSONB DEFAULT NULL;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_projects_review_status ON projects USING GIN (review_status);

