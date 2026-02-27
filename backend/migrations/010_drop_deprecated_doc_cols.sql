-- Phase 3: Drop deprecated columns from documents table.
-- These values are now sourced from compliance_rules (per-company or global)
-- and document_types (is_mandatory), so the per-row copies are redundant.

ALTER TABLE documents
    DROP COLUMN IF EXISTS grace_period_days,
    DROP COLUMN IF EXISTS fine_per_day,
    DROP COLUMN IF EXISTS fine_type,
    DROP COLUMN IF EXISTS fine_cap,
    DROP COLUMN IF EXISTS is_mandatory;
