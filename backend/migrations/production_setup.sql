-- ============================================================
-- MANPOWER MANAGEMENT SYSTEM - PRODUCTION DATABASE SETUP
-- ============================================================
-- Paste this entire file into Neon SQL Editor to set up the
-- production database. Run it ONCE on a fresh database.
-- ============================================================

-- ── Core Tables ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS companies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL UNIQUE,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employees (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    trade           VARCHAR(100) NOT NULL,
    mobile          VARCHAR(20) NOT NULL,
    joining_date    DATE NOT NULL,
    photo_url       TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id     UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    document_type   VARCHAR(100) NOT NULL,
    expiry_date     DATE,
    file_url        TEXT NOT NULL DEFAULT '',
    file_name       VARCHAR(255) NOT NULL DEFAULT '',
    file_size       BIGINT NOT NULL DEFAULT 0,
    file_type       VARCHAR(50) NOT NULL DEFAULT '',
    last_updated    TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employees_company_id ON employees(company_id);
CREATE INDEX IF NOT EXISTS idx_employees_name ON employees(name);
CREATE INDEX IF NOT EXISTS idx_documents_employee_id ON documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_documents_expiry_date ON documents(expiry_date);

-- ── Auth & Audit (migration 002) ────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name          VARCHAR(100) NOT NULL,
    role          VARCHAR(20) NOT NULL DEFAULT 'admin',
    created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE companies ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);

CREATE TABLE IF NOT EXISTS activity_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id),
    action      VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id   UUID NOT NULL,
    details     JSONB,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_companies_user_id ON companies(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at DESC);

-- ── Employee Extensions (migration 003) ─────────────────────

ALTER TABLE employees ADD COLUMN IF NOT EXISTS gender VARCHAR(10);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS nationality VARCHAR(60);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS passport_number VARCHAR(30);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS native_location VARCHAR(120);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS current_location VARCHAR(120);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS salary NUMERIC(12,2);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';

CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
CREATE INDEX IF NOT EXISTS idx_employees_nationality ON employees(nationality);

CREATE TABLE IF NOT EXISTS salary_records (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    month       INT NOT NULL CHECK (month BETWEEN 1 AND 12),
    year        INT NOT NULL CHECK (year >= 2020),
    amount      NUMERIC(12,2) NOT NULL,
    status      VARCHAR(20) NOT NULL DEFAULT 'pending',
    paid_date   DATE,
    notes       TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(employee_id, month, year)
);

CREATE INDEX IF NOT EXISTS idx_salary_employee ON salary_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_month_year ON salary_records(year, month);
CREATE INDEX IF NOT EXISTS idx_salary_status ON salary_records(status);

CREATE TABLE IF NOT EXISTS notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       VARCHAR(200) NOT NULL,
    message     TEXT NOT NULL,
    type        VARCHAR(30) NOT NULL,
    read        BOOLEAN DEFAULT FALSE,
    entity_type VARCHAR(30),
    entity_id   UUID,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at DESC);

-- ── Document Primary Flag (migration 004) ───────────────────

ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT FALSE;

-- ── Company Currency (migration 005) ────────────────────────

ALTER TABLE companies ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'AED';

-- ── Compliance Engine (migration 006) ───────────────────────

ALTER TABLE documents ADD COLUMN IF NOT EXISTS document_number VARCHAR(100);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS issue_date DATE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS grace_period_days INTEGER DEFAULT 0;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS fine_per_day DECIMAL(10,2) DEFAULT 0;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS fine_type VARCHAR(20) DEFAULT 'daily';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS fine_cap DECIMAL(10,2) DEFAULT 0;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_mandatory BOOLEAN DEFAULT false;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

ALTER TABLE employees ADD COLUMN IF NOT EXISTS exit_type VARCHAR(20);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS exit_date DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS exit_notes TEXT;

ALTER TABLE companies ADD COLUMN IF NOT EXISTS trade_license_number VARCHAR(100);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS establishment_card_number VARCHAR(100);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS mohre_category VARCHAR(10);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS regulatory_authority VARCHAR(50) DEFAULT 'MOHRE';

CREATE TABLE IF NOT EXISTS document_dependencies (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    blocking_doc_type VARCHAR(50) NOT NULL,
    blocked_doc_type  VARCHAR(50) NOT NULL,
    description       TEXT NOT NULL,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO document_dependencies (blocking_doc_type, blocked_doc_type, description)
SELECT * FROM (VALUES
    ('passport',        'visa',        'Passport must have 6+ months validity to renew Residence Visa'),
    ('health_insurance','work_permit', 'Valid health insurance required to issue/renew Work Permit'),
    ('visa',            'emirates_id', 'Valid residence visa required to renew Emirates ID'),
    ('medical_fitness', 'visa',        'Medical fitness certificate required for visa issuance/renewal')
) AS seed(a, b, c)
WHERE NOT EXISTS (SELECT 1 FROM document_dependencies LIMIT 1);

CREATE INDEX IF NOT EXISTS idx_documents_mandatory
    ON documents(employee_id) WHERE is_mandatory = true;
CREATE INDEX IF NOT EXISTS idx_documents_expiry
    ON documents(expiry_date) WHERE expiry_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employees_exit
    ON employees(exit_type) WHERE exit_type IS NOT NULL;

-- ── Admin Settings (migration 007) ──────────────────────────

CREATE TABLE IF NOT EXISTS document_types (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_type           VARCHAR(100) NOT NULL UNIQUE,
    display_name       VARCHAR(200) NOT NULL,
    is_mandatory       BOOLEAN NOT NULL DEFAULT FALSE,
    has_expiry         BOOLEAN NOT NULL DEFAULT TRUE,
    number_label       VARCHAR(100) NOT NULL DEFAULT 'Document Number',
    number_placeholder VARCHAR(200) NOT NULL DEFAULT '',
    expiry_label       VARCHAR(100) NOT NULL DEFAULT 'Expiry Date',
    sort_order         INT NOT NULL DEFAULT 100,
    metadata_fields    JSONB NOT NULL DEFAULT '[]',
    is_system          BOOLEAN NOT NULL DEFAULT FALSE,
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS compliance_rules (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id        UUID REFERENCES companies(id) ON DELETE CASCADE,
    doc_type          VARCHAR(100) NOT NULL,
    grace_period_days INT NOT NULL DEFAULT 0,
    fine_per_day      DECIMAL(10,2) NOT NULL DEFAULT 0,
    fine_type         VARCHAR(20) NOT NULL DEFAULT 'daily',
    fine_cap          DECIMAL(10,2) NOT NULL DEFAULT 0,
    is_mandatory      BOOLEAN DEFAULT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(company_id, doc_type)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_compliance_rules_global_unique
    ON compliance_rules(doc_type) WHERE company_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_compliance_rules_company
    ON compliance_rules(company_id) WHERE company_id IS NOT NULL;

-- Seed document types
INSERT INTO document_types (doc_type, display_name, is_mandatory, has_expiry, number_label, number_placeholder, expiry_label, sort_order, metadata_fields, is_system)
SELECT * FROM (VALUES
    ('passport',         'Passport',                    TRUE,  TRUE, 'Passport Number',             'e.g. A12345678',          'Expiry Date',   10, '[{"key":"nationality","label":"Nationality","type":"text","placeholder":"e.g. Indian"},{"key":"issuing_country","label":"Issuing Country","type":"text","placeholder":"e.g. India"}]'::jsonb, TRUE),
    ('visa',             'Residence Visa',              TRUE,  TRUE, 'Visa Number',                 'e.g. 201/2024/1234567',   'Expiry Date',   20, '[{"key":"visa_type","label":"Visa Type","type":"select","options":[{"value":"employment","label":"Employment"},{"value":"residence","label":"Residence"},{"value":"mission","label":"Mission"},{"value":"green","label":"Green Visa"},{"value":"golden","label":"Golden Visa"}]},{"key":"sponsor","label":"Sponsor / Company","type":"text","placeholder":"Sponsoring company"},{"key":"linked_passport","label":"Linked Passport Number","type":"text","placeholder":"Passport number"}]'::jsonb, TRUE),
    ('emirates_id',      'Emirates ID',                 TRUE,  TRUE, 'Emirates ID Number',          'e.g. 784-1990-1234567-1', 'Expiry Date',   30, '[{"key":"linked_visa","label":"Linked Visa Number","type":"text","placeholder":"Visa number"}]'::jsonb, TRUE),
    ('work_permit',      'Work Permit / Labour Card',   TRUE,  TRUE, 'Permit / Labour Card Number', 'e.g. 1234567',            'Expiry Date',   40, '[{"key":"mohre_file_number","label":"MoHRE File Number","type":"text","placeholder":"e.g. 12345"},{"key":"job_title","label":"Job Title (on permit)","type":"text","placeholder":"e.g. Electrician"}]'::jsonb, TRUE),
    ('health_insurance', 'Health Insurance',             TRUE,  TRUE, 'Policy Number',               'e.g. POL-2024-12345',     'Expiry Date',   50, '[{"key":"insurer_name","label":"Insurance Provider","type":"text","placeholder":"e.g. Daman, Oman Insurance"},{"key":"coverage_amount","label":"Coverage Amount (AED)","type":"number","placeholder":"e.g. 250000"}]'::jsonb, TRUE),
    ('iloe_insurance',   'ILOE Insurance',              TRUE,  TRUE, 'Subscription ID',             'e.g. ILOE-2024-12345',    'Renewal Date',  60, '[{"key":"category","label":"Category","type":"select","options":[{"value":"A","label":"Category A"},{"value":"B","label":"Category B"}]},{"key":"subscription_status","label":"Subscription Status","type":"select","options":[{"value":"active","label":"Active"},{"value":"lapsed","label":"Lapsed"}]}]'::jsonb, TRUE),
    ('medical_fitness',  'Medical Fitness Certificate',  TRUE,  TRUE, 'Certificate Number',          'e.g. MED-2024-12345',     'Valid Until',   70, '[{"key":"test_date","label":"Test Date","type":"date"},{"key":"result","label":"Result","type":"select","options":[{"value":"fit","label":"Fit"},{"value":"unfit","label":"Unfit"}]}]'::jsonb, TRUE),
    ('trade_license',    'Trade License',               FALSE, TRUE, 'License Number',              'e.g. TL-12345',           'Expiry Date',   80, '[]'::jsonb, TRUE),
    ('other',            'Other',                       FALSE, TRUE, 'Document Number',             'e.g. DOC-12345',          'Expiry Date',  999, '[{"key":"custom_name","label":"Document Name","type":"text","placeholder":"e.g. Certificate of Good Conduct","required":true}]'::jsonb, TRUE)
) AS seed(a, b, c, d, e, f, g, h, i, j)
WHERE NOT EXISTS (SELECT 1 FROM document_types LIMIT 1);

-- Seed global compliance rules
INSERT INTO compliance_rules (company_id, doc_type, grace_period_days, fine_per_day, fine_type, fine_cap)
SELECT NULL, a, b, c, d, e FROM (VALUES
    ('passport',         0,   0.00, 'daily',    0.00),
    ('visa',             0,  50.00, 'daily',    0.00),
    ('emirates_id',     30,  20.00, 'daily', 1000.00),
    ('work_permit',     50, 500.00, 'one_time', 500.00),
    ('health_insurance', 0, 500.00, 'monthly', 150000.00),
    ('iloe_insurance',   0, 400.00, 'one_time',  400.00),
    ('medical_fitness',  0,   0.00, 'daily',    0.00)
) AS seed(a, b, c, d, e)
WHERE NOT EXISTS (SELECT 1 FROM compliance_rules LIMIT 1);

-- ============================================================
-- DONE! Your production database is ready.
-- ============================================================
