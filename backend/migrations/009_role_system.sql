-- 009_role_system.sql
-- Phase 2: Multi-role system with company-scoped access
-- Roles: super_admin (4), admin (3), company_owner (2), viewer (1)

-- 1. Junction table for user-company scoping
CREATE TABLE IF NOT EXISTS user_companies (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_user_companies_user ON user_companies(user_id);
CREATE INDEX IF NOT EXISTS idx_user_companies_company ON user_companies(company_id);

-- 2. Backfill: link existing company creators to their companies
INSERT INTO user_companies (user_id, company_id)
SELECT user_id, id FROM companies WHERE user_id IS NOT NULL
ON CONFLICT DO NOTHING;
