-- Migration 008: Document Management Rework
-- 1. Adds per-field visibility/required flags to document_types
-- 2. Updates mandatory document list from 7 to 5
-- 3. Compliance fields on documents are deprecated (read from compliance_rules at query time)

-- ── 1. Add field config columns to document_types ─────────────

ALTER TABLE document_types ADD COLUMN IF NOT EXISTS show_document_number BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE document_types ADD COLUMN IF NOT EXISTS require_document_number BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE document_types ADD COLUMN IF NOT EXISTS show_issue_date BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE document_types ADD COLUMN IF NOT EXISTS require_issue_date BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE document_types ADD COLUMN IF NOT EXISTS show_expiry_date BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE document_types ADD COLUMN IF NOT EXISTS require_expiry_date BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE document_types ADD COLUMN IF NOT EXISTS show_file BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE document_types ADD COLUMN IF NOT EXISTS require_file BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. Set field requirements for 5 mandatory types ──────────

UPDATE document_types SET
    require_document_number = TRUE,
    require_issue_date = TRUE,
    require_expiry_date = TRUE,
    require_file = TRUE
WHERE doc_type IN ('passport', 'visa', 'emirates_id', 'work_permit', 'iloe_insurance');

-- ── 3. Health Insurance & Medical Fitness: tracked but not mandatory

UPDATE document_types SET is_mandatory = FALSE
WHERE doc_type IN ('health_insurance', 'medical_fitness');

-- Health insurance & medical fitness: require expiry but not issue date
UPDATE document_types SET
    require_expiry_date = TRUE,
    require_file = TRUE
WHERE doc_type IN ('health_insurance', 'medical_fitness');

-- Trade license: expiry + file required
UPDATE document_types SET
    require_expiry_date = TRUE,
    require_file = TRUE
WHERE doc_type = 'trade_license';

-- Other: only file required
UPDATE document_types SET
    require_file = TRUE,
    show_issue_date = FALSE,
    require_issue_date = FALSE
WHERE doc_type = 'other';
