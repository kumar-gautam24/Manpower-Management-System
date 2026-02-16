-- ============================================================
-- Migration 006: UAE Document Compliance Engine
-- ============================================================
-- Adds compliance tracking columns to documents, employee exit
-- fields, company regulatory info, and document dependencies.
-- Safe to run multiple times (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

-- ── 1. Document compliance columns ──────────────────────────

ALTER TABLE documents ADD COLUMN IF NOT EXISTS document_number VARCHAR(100);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS issue_date DATE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS grace_period_days INTEGER DEFAULT 0;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS fine_per_day DECIMAL(10,2) DEFAULT 0;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS fine_type VARCHAR(20) DEFAULT 'daily';
    -- fine_type: 'daily' | 'monthly' | 'one_time'
ALTER TABLE documents ADD COLUMN IF NOT EXISTS fine_cap DECIMAL(10,2) DEFAULT 0;
    -- fine_cap: 0 = uncapped
ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_mandatory BOOLEAN DEFAULT false;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
    -- Type-specific fields (visa UID, EID number, policy number, etc.)

-- ── 2. Drop single-primary unique index ─────────────────────
-- We now track ALL mandatory docs simultaneously, not just one.
DROP INDEX IF EXISTS idx_documents_primary_per_employee;

-- ── 3. Normalize document_type values ───────────────────────
-- Merge "Labor Card" variants into canonical "work_permit"
UPDATE documents SET document_type = 'work_permit'
  WHERE document_type IN ('Labor Card', 'labor_card', 'labour_card', 'Work Permit');
-- Normalize "Medical Insurance" → "health_insurance"
UPDATE documents SET document_type = 'health_insurance'
  WHERE document_type = 'Medical Insurance';
-- Normalize others for consistency
UPDATE documents SET document_type = 'passport'
  WHERE document_type = 'Passport';
UPDATE documents SET document_type = 'visa'
  WHERE document_type IN ('Visa', 'Residence Visa');
UPDATE documents SET document_type = 'emirates_id'
  WHERE document_type IN ('Emirates ID', 'EmiratesID');
UPDATE documents SET document_type = 'medical_fitness'
  WHERE document_type IN ('Medical Fitness', 'Medical Fitness Certificate');
UPDATE documents SET document_type = 'trade_license'
  WHERE document_type = 'Trade License';

-- ── 4. Employee exit tracking ───────────────────────────────
ALTER TABLE employees ADD COLUMN IF NOT EXISTS exit_type VARCHAR(20);
    -- exit_type: 'resigned' | 'terminated' | 'absconded'
ALTER TABLE employees ADD COLUMN IF NOT EXISTS exit_date DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS exit_notes TEXT;

-- ── 5. Company regulatory fields ────────────────────────────
ALTER TABLE companies ADD COLUMN IF NOT EXISTS trade_license_number VARCHAR(100);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS establishment_card_number VARCHAR(100);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS mohre_category VARCHAR(10);
    -- mohre_category: '1' | '2' | '3'
ALTER TABLE companies ADD COLUMN IF NOT EXISTS regulatory_authority VARCHAR(50) DEFAULT 'MOHRE';
    -- regulatory_authority: 'MOHRE' | 'JAFZA' | 'DMCC' | 'DAFZA' | 'DIFC' | etc.

-- ── 6. Document dependencies ────────────────────────────────
-- Tracks which document types block renewal of other types.
CREATE TABLE IF NOT EXISTS document_dependencies (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    blocking_doc_type VARCHAR(50) NOT NULL,
    blocked_doc_type  VARCHAR(50) NOT NULL,
    description       TEXT NOT NULL,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default UAE dependencies (only if table is empty)
INSERT INTO document_dependencies (blocking_doc_type, blocked_doc_type, description)
SELECT * FROM (VALUES
    ('passport',        'visa',        'Passport must have 6+ months validity to renew Residence Visa'),
    ('health_insurance','work_permit', 'Valid health insurance required to issue/renew Work Permit'),
    ('visa',            'emirates_id', 'Valid residence visa required to renew Emirates ID'),
    ('medical_fitness', 'visa',        'Medical fitness certificate required for visa issuance/renewal')
) AS seed(a, b, c)
WHERE NOT EXISTS (SELECT 1 FROM document_dependencies LIMIT 1);

-- ── 7. Performance indexes ──────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_documents_mandatory
    ON documents(employee_id) WHERE is_mandatory = true;
CREATE INDEX IF NOT EXISTS idx_documents_expiry
    ON documents(expiry_date) WHERE expiry_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employees_exit
    ON employees(exit_type) WHERE exit_type IS NOT NULL;
