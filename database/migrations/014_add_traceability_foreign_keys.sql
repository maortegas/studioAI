-- Migration: Add Traceability Foreign Keys
-- Establishes complete traceability chain: Project → PRD → Stories → Design → RFC → Breakdown → Coding
-- This ensures nothing is left unaddressed and maintains consistency across the development flow

-- ============================================
-- Step 1: PRD → Stories
-- ============================================
-- Add prd_id to tasks table to link stories to their source PRD
ALTER TABLE tasks 
  ADD COLUMN IF NOT EXISTS prd_id UUID REFERENCES prd_documents(id) ON DELETE SET NULL;

-- ============================================
-- Step 2: Stories → Design (Many-to-Many)
-- ============================================
-- Create junction table for many-to-many relationship between stories and user flows
CREATE TABLE IF NOT EXISTS story_user_flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_flow_id UUID NOT NULL REFERENCES user_flows(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(story_id, user_flow_id)
);

-- ============================================
-- Step 3: Design → RFC
-- ============================================
-- Add user_flow_id to rfc_documents to link RFC to its source design
ALTER TABLE rfc_documents
  ADD COLUMN IF NOT EXISTS user_flow_id UUID REFERENCES user_flows(id) ON DELETE SET NULL;

-- ============================================
-- Step 4: Indexes for Performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_tasks_prd_id ON tasks(prd_id);
CREATE INDEX IF NOT EXISTS idx_story_user_flows_story_id ON story_user_flows(story_id);
CREATE INDEX IF NOT EXISTS idx_story_user_flows_user_flow_id ON story_user_flows(user_flow_id);
CREATE INDEX IF NOT EXISTS idx_rfc_documents_user_flow_id ON rfc_documents(user_flow_id);

-- ============================================
-- Step 5: Comments for Documentation
-- ============================================
COMMENT ON COLUMN tasks.prd_id IS 'Links user story to its source PRD document';
COMMENT ON TABLE story_user_flows IS 'Many-to-many relationship between user stories and user flows (design)';
COMMENT ON COLUMN rfc_documents.user_flow_id IS 'Links RFC to its source user flow (design)';

