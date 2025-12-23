-- Migration: New Flow Schema
-- Adds tables and columns for the new 8-step development flow

-- ============================================
-- Paso 1: PRD Documents
-- ============================================
CREATE TABLE IF NOT EXISTS prd_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    vision TEXT NOT NULL,
    personas JSONB NOT NULL,  -- Array of personas: [{"role": "...", "needs": "...", "goals": "..."}]
    status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'approved')),
    validated_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(project_id)  -- One PRD per project
);

-- ============================================
-- Paso 3: Design & UX Discovery
-- ============================================
CREATE TABLE IF NOT EXISTS user_flows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    flow_name VARCHAR(255) NOT NULL,
    flow_diagram TEXT,  -- Mermaid diagram or structured text
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prototypes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    file_path VARCHAR(500) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    analysis_result JSONB,  -- IA analysis result: {"elements": [...], "flows": [...], "insights": [...]}
    uploaded_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================
-- Paso 4: RFC / System Design
-- ============================================
CREATE TABLE IF NOT EXISTS rfc_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,  -- Markdown content of the RFC
    architecture_type VARCHAR(50),  -- monorepo, polyrepo, microservices, monolithic, etc.
    status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved', 'implemented')),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rfc_id UUID NOT NULL REFERENCES rfc_documents(id) ON DELETE CASCADE,
    contract_type VARCHAR(50) NOT NULL CHECK (contract_type IN ('openapi', 'swagger', 'graphql', 'grpc')),
    contract_content JSONB,  -- OpenAPI/Swagger JSON or GraphQL schema
    file_path VARCHAR(500),
    version VARCHAR(50),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS database_schemas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rfc_id UUID NOT NULL REFERENCES rfc_documents(id) ON DELETE CASCADE,
    schema_type VARCHAR(50) NOT NULL CHECK (schema_type IN ('sql', 'nosql', 'graph', 'document')),
    schema_content TEXT NOT NULL,  -- SQL DDL or NoSQL schema definition
    migrations_path VARCHAR(500),  -- Path to migration files
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================
-- Paso 5: Breakdown & Estimation
-- ============================================
CREATE TABLE IF NOT EXISTS epics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    rfc_id UUID REFERENCES rfc_documents(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    story_points INTEGER,
    status VARCHAR(50) NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'completed')),
    order_index INTEGER,  -- For sorting epics
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================
-- Extend existing tables
-- ============================================

-- Extend tasks table for new flow requirements
ALTER TABLE tasks 
    ADD COLUMN IF NOT EXISTS acceptance_criteria JSONB,  -- Array of AC: [{"criterion": "...", "type": "functional|technical"}]
    ADD COLUMN IF NOT EXISTS generated_from_prd BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS story_points INTEGER,
    ADD COLUMN IF NOT EXISTS epic_id UUID REFERENCES epics(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS estimated_days INTEGER CHECK (estimated_days IS NULL OR estimated_days <= 3),  -- Max 2-3 days per task
    ADD COLUMN IF NOT EXISTS breakdown_order INTEGER;  -- Order in breakdown sequence

-- ============================================
-- Indexes for performance
-- ============================================

CREATE INDEX IF NOT EXISTS idx_prd_documents_project_id ON prd_documents(project_id);
CREATE INDEX IF NOT EXISTS idx_prd_documents_status ON prd_documents(status);

CREATE INDEX IF NOT EXISTS idx_user_flows_project_id ON user_flows(project_id);
CREATE INDEX IF NOT EXISTS idx_prototypes_project_id ON prototypes(project_id);

CREATE INDEX IF NOT EXISTS idx_rfc_documents_project_id ON rfc_documents(project_id);
CREATE INDEX IF NOT EXISTS idx_rfc_documents_status ON rfc_documents(status);
CREATE INDEX IF NOT EXISTS idx_api_contracts_rfc_id ON api_contracts(rfc_id);
CREATE INDEX IF NOT EXISTS idx_database_schemas_rfc_id ON database_schemas(rfc_id);

CREATE INDEX IF NOT EXISTS idx_epics_project_id ON epics(project_id);
CREATE INDEX IF NOT EXISTS idx_epics_rfc_id ON epics(rfc_id);
CREATE INDEX IF NOT EXISTS idx_epics_status ON epics(status);
CREATE INDEX IF NOT EXISTS idx_tasks_epic_id ON tasks(epic_id);
CREATE INDEX IF NOT EXISTS idx_tasks_story_points ON tasks(story_points);

-- ============================================
-- Triggers for updated_at
-- ============================================

CREATE OR REPLACE FUNCTION update_prd_document_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_prd_document_updated_at
    BEFORE UPDATE ON prd_documents
    FOR EACH ROW
    EXECUTE FUNCTION update_prd_document_updated_at();

CREATE OR REPLACE FUNCTION update_user_flow_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_user_flow_updated_at
    BEFORE UPDATE ON user_flows
    FOR EACH ROW
    EXECUTE FUNCTION update_user_flow_updated_at();

CREATE OR REPLACE FUNCTION update_rfc_document_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_rfc_document_updated_at
    BEFORE UPDATE ON rfc_documents
    FOR EACH ROW
    EXECUTE FUNCTION update_rfc_document_updated_at();

CREATE OR REPLACE FUNCTION update_api_contract_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_api_contract_updated_at
    BEFORE UPDATE ON api_contracts
    FOR EACH ROW
    EXECUTE FUNCTION update_api_contract_updated_at();

CREATE OR REPLACE FUNCTION update_database_schema_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_database_schema_updated_at
    BEFORE UPDATE ON database_schemas
    FOR EACH ROW
    EXECUTE FUNCTION update_database_schema_updated_at();

CREATE OR REPLACE FUNCTION update_epic_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_epic_updated_at
    BEFORE UPDATE ON epics
    FOR EACH ROW
    EXECUTE FUNCTION update_epic_updated_at();
