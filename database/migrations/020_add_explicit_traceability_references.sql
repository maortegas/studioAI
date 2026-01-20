-- Migration: Add Explicit Traceability References
-- Adds explicit references between Story, Design, and RFC sections
-- Includes unique visible codes in RFC (RFC-SEC-001, RFC-SEC-002, etc.)

-- ============================================
-- Step 1: Add explicit reference fields to tasks
-- ============================================
ALTER TABLE tasks 
    ADD COLUMN IF NOT EXISTS story_section_reference TEXT,
    ADD COLUMN IF NOT EXISTS design_section_reference TEXT,
    ADD COLUMN IF NOT EXISTS rfc_section_reference TEXT,
    ADD COLUMN IF NOT EXISTS rfc_section_identifier TEXT,  -- Código único: RFC-SEC-001
    ADD COLUMN IF NOT EXISTS rfc_section_code TEXT,        -- Alias para rfc_section_identifier
    ADD COLUMN IF NOT EXISTS rfc_section_hash TEXT,
    ADD COLUMN IF NOT EXISTS references_validated_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS references_validation_status VARCHAR(50) DEFAULT 'pending';

-- ============================================
-- Step 2: Create table to map RFC section codes
-- ============================================
CREATE TABLE IF NOT EXISTS rfc_section_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rfc_id UUID NOT NULL REFERENCES rfc_documents(id) ON DELETE CASCADE,
    section_code VARCHAR(50) NOT NULL,  -- RFC-SEC-001, RFC-SEC-002, etc.
    section_header TEXT NOT NULL,       -- Texto del header original
    section_level INTEGER NOT NULL,     -- 1=h1, 2=h2, 3=h3, etc.
    section_order INTEGER NOT NULL,     -- Orden en el documento
    full_section_content TEXT,          -- Contenido completo de la sección
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(rfc_id, section_code)
);

CREATE INDEX IF NOT EXISTS idx_rfc_section_codes_rfc_id ON rfc_section_codes(rfc_id);
CREATE INDEX IF NOT EXISTS idx_rfc_section_codes_code ON rfc_section_codes(section_code);
CREATE INDEX IF NOT EXISTS idx_tasks_rfc_section_code ON tasks(rfc_section_code);

-- ============================================
-- Step 3: Create table for explicit task dependencies
-- ============================================
CREATE TABLE IF NOT EXISTS task_dependencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    dependency_type VARCHAR(50) DEFAULT 'blocking',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(task_id, depends_on_task_id),
    CHECK (task_id != depends_on_task_id)
);

CREATE INDEX IF NOT EXISTS idx_task_dependencies_task_id ON task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on ON task_dependencies(depends_on_task_id);

-- ============================================
-- Step 4: Create table for RFC section coverage tracking
-- ============================================
CREATE TABLE IF NOT EXISTS rfc_section_coverage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rfc_id UUID NOT NULL REFERENCES rfc_documents(id) ON DELETE CASCADE,
    section_code TEXT NOT NULL,  -- RFC-SEC-XXX
    section_header TEXT NOT NULL,
    covered_by_tasks UUID[],
    coverage_status VARCHAR(50) DEFAULT 'partial',
    last_verified_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rfc_coverage_rfc_id ON rfc_section_coverage(rfc_id);
CREATE INDEX IF NOT EXISTS idx_rfc_coverage_section_code ON rfc_section_coverage(section_code);

-- ============================================
-- Step 5: Comments for Documentation
-- ============================================
COMMENT ON COLUMN tasks.story_section_reference IS 'Exact text from user story that this task fulfills';
COMMENT ON COLUMN tasks.design_section_reference IS 'Exact design element from user flow for this task';
COMMENT ON COLUMN tasks.rfc_section_reference IS 'Complete RFC section with technical specifications';
COMMENT ON COLUMN tasks.rfc_section_identifier IS 'Unique section code from RFC (e.g., RFC-SEC-001)';
COMMENT ON COLUMN tasks.rfc_section_code IS 'Alias for rfc_section_identifier';
COMMENT ON COLUMN tasks.rfc_section_hash IS 'SHA-256 hash of RFC section for validation';
COMMENT ON TABLE rfc_section_codes IS 'Maps unique codes (RFC-SEC-XXX) to RFC sections';
COMMENT ON TABLE task_dependencies IS 'Explicit dependencies between tasks';
COMMENT ON TABLE rfc_section_coverage IS 'Tracks which tasks cover which RFC sections';

