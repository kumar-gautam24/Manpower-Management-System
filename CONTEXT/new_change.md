# Employee Document Compliance System — Implementation Spec


> This document describes WHAT to build, WHY, and the exact data shapes.
> It assumes the existing Manpower Management System (Go backend + Next.js frontend) as the starting point.

---

## Context

This app manages employee documents for a Dubai-based client who runs **multiple companies** with **multiple employees**. In the UAE, employers are legally responsible for keeping every employee's documents valid. Expired documents result in **daily fines** ranging from AED 20/day to AED 50,000+ per worker. The app must track 7 mandatory document types per employee, calculate grace periods, estimate fine exposure, and alert before anything lapses.

---

## Current State (What Already Exists)

- Employee CRUD (all 13 fields: name, trade, company, mobile, joining date, gender, DOB, nationality, passport number, native location, current location, salary, status)
- Company CRUD (name only in UI, currency column exists in DB but not exposed)
- Document tracking: one-at-a-time add via dialog (type, expiry date, file upload)
- Document types available: Visa, Passport, Emirates ID, Labor Card, Medical Insurance, Work Permit, Trade License, Other
- Dashboard with 4 metric cards (Total Employees, Active Documents, Expiring Soon, Expired)
- Document status donut chart, employees by company bar chart, critical expiry alerts list
- Employee list with search, company filter, doc status filter, trade filter, sorting
- Export CSV button on employee list
- Notification bell icon in header (backend exists, NO frontend UI behind it)
- Salary module with generation and export
- Activity log page
- Dark theme UI with shadcn/ui components

---

## What Needs to Change

### Priority 1: Database Schema Changes

#### 1.1 — Add fields to `documents` table

```sql
ALTER TABLE documents ADD COLUMN IF NOT EXISTS document_number VARCHAR(100);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS issue_date DATE;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS grace_period_days INTEGER DEFAULT 0;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS fine_per_day DECIMAL(10,2) DEFAULT 0;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS fine_type VARCHAR(20) DEFAULT 'daily'; -- 'daily', 'monthly', 'one_time'
ALTER TABLE documents ADD COLUMN IF NOT EXISTS fine_cap DECIMAL(10,2) DEFAULT 0; -- 0 means no cap
ALTER TABLE documents ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'incomplete'; -- 'incomplete', 'valid', 'expiring_soon', 'in_grace', 'penalty_active'
ALTER TABLE documents ADD COLUMN IF NOT EXISTS is_mandatory BOOLEAN DEFAULT false;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'; -- for type-specific fields
```

The `metadata` JSONB column stores type-specific fields:
- **Visa**: `{ "visa_uid": "", "visa_type": "", "sponsor": "", "linked_passport": "" }`
- **Emirates ID**: `{ "eid_number": "", "linked_visa": "" }`
- **Work Permit / Labour Card**: `{ "permit_number": "", "mohre_file_number": "", "job_title": "", "company_category": "" }`
- **Health Insurance**: `{ "policy_number": "", "insurer_name": "", "plan_type": "", "coverage_amount": 0 }`
- **ILOE Insurance**: `{ "category": "A|B", "subscription_status": "active|lapsed", "premium_amount": 0 }`
- **Medical Fitness**: `{ "certificate_number": "", "test_result": "fit|unfit" }`
- **Passport**: `{ "nationality": "", "issuing_country": "" }`

#### 1.2 — Add fields to `companies` table (if not already present)

```sql
ALTER TABLE companies ADD COLUMN IF NOT EXISTS trade_license_number VARCHAR(100);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS establishment_card_number VARCHAR(100);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS mohre_category VARCHAR(10); -- '1', '2', '3'
ALTER TABLE companies ADD COLUMN IF NOT EXISTS regulatory_authority VARCHAR(50) DEFAULT 'MOHRE'; -- 'MOHRE', 'JAFZA', 'DMCC', 'DAFZA', etc.
```

Also ensure `currency` column exists and is exposed in the API + UI.

#### 1.3 — Add `document_dependencies` table

```sql
CREATE TABLE IF NOT EXISTS document_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocking_doc_type VARCHAR(50) NOT NULL,  -- e.g. 'passport'
  blocked_doc_type VARCHAR(50) NOT NULL,   -- e.g. 'visa'
  description TEXT NOT NULL,               -- e.g. 'Passport must be valid to renew Visa'
  created_at TIMESTAMP DEFAULT NOW()
);

-- Seed default UAE dependencies
INSERT INTO document_dependencies (blocking_doc_type, blocked_doc_type, description) VALUES
  ('passport', 'visa', 'Passport must have 6+ months validity to renew Residence Visa'),
  ('health_insurance', 'work_permit', 'Valid health insurance required to issue/renew Work Permit'),
  ('iloe_insurance', 'visa', 'ILOE fine must be cleared before visa renewal processing'),
  ('visa', 'emirates_id', 'Valid residence visa required to renew Emirates ID'),
  ('medical_fitness', 'visa', 'Medical fitness certificate required for visa issuance/renewal');
```

#### 1.4 — Add `notification_preferences` table (if not exists)

```sql
CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  alert_90_days BOOLEAN DEFAULT true,
  alert_60_days BOOLEAN DEFAULT true,
  alert_30_days BOOLEAN DEFAULT true,
  alert_15_days BOOLEAN DEFAULT true,
  alert_7_days BOOLEAN DEFAULT true,
  alert_daily_after_expiry BOOLEAN DEFAULT true,
  email_notifications BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

### Priority 2: Document Type Normalization

#### Merge "Work Permit" and "Labour Card" into one type

In the UAE, the labour card IS the work permit (digital, issued by MoHRE). Having both confuses users.

- Rename/merge to: `work_permit` (display as "Work Permit / Labour Card")
- Update all existing records where `doc_type = 'labor_card'` to `doc_type = 'work_permit'`
- Migration: `UPDATE documents SET doc_type = 'work_permit' WHERE doc_type = 'labor_card';`

#### Add ILOE Insurance type

Add `iloe_insurance` as a new document type. Currently missing from the type chips.

#### Final canonical document types:

```
passport
visa
emirates_id
work_permit        -- was "Labor Card" + "Work Permit", now merged
health_insurance   -- was "Medical Insurance"
iloe_insurance     -- NEW
medical_fitness    -- was "Medical Fitness Certificate" if it existed, or treat as part of Other
trade_license      -- company-level, not per-employee mandatory
other              -- catch-all for additional docs
```

The **7 mandatory per-employee types** are: `passport`, `visa`, `emirates_id`, `work_permit`, `health_insurance`, `iloe_insurance`, `medical_fitness`.

---

### Priority 3: Auto-Create 7 Mandatory Document Slots

#### Backend Logic

When a new employee is created (POST /api/employees), after inserting the employee record, automatically insert 7 document rows:

```go
mandatoryDocs := []struct {
    DocType        string
    GracePeriodDays int
    FinePerDay     float64
    FineType       string
    FineCap        float64
}{
    {"passport", 0, 0, "daily", 0},              // no grace, blocks others
    {"visa", 30, 50, "daily", 0},                 // 30 day grace, AED 50/day
    {"emirates_id", 30, 20, "daily", 1000},        // 30 day grace, AED 20/day, capped at 1000
    {"work_permit", 50, 500, "one_time", 500},     // 50 day grace, AED 500 flat
    {"health_insurance", 30, 500, "monthly", 150000}, // 30 day grace, AED 500-150k/month
    {"iloe_insurance", 0, 400, "one_time", 400},   // no grace, AED 400 one-time
    {"medical_fitness", 0, 0, "daily", 0},         // no grace, blocks visa
}
```

Each inserted document should have:
- `employee_id`: the new employee's ID
- `doc_type`: from the list above
- `is_mandatory`: true
- `status`: "incomplete"
- `grace_period_days`, `fine_per_day`, `fine_type`, `fine_cap`: from the list above
- All other fields (document_number, issue_date, expiry_date, file_url) left NULL

#### For Existing Employees

Create a one-time migration or a background job that checks each employee and inserts missing mandatory document slots. If an employee already has a `passport` document, don't create another one — just ensure the new fields (grace_period_days, fine_per_day, etc.) are populated.

---

### Priority 4: Document Status Calculation

#### Backend — Computed Status

Document status should be **computed** based on current date, expiry_date, and grace_period_days. Either compute on read or run a periodic job (cron every hour). The logic:

```
if document_number IS NULL or expiry_date IS NULL:
    status = "incomplete"
else if expiry_date > today + 30 days:
    status = "valid"
else if expiry_date > today AND expiry_date <= today + 30 days:
    status = "expiring_soon"
else if expiry_date <= today AND today <= expiry_date + grace_period_days:
    status = "in_grace"
else if today > expiry_date + grace_period_days:
    status = "penalty_active"
```

#### Fine Calculation (computed field, never stored)

```
if status != "penalty_active":
    fine = 0
else:
    days_in_penalty = today - (expiry_date + grace_period_days)
    
    if fine_type == "daily":
        fine = days_in_penalty * fine_per_day
        if fine_cap > 0: fine = min(fine, fine_cap)
    
    elif fine_type == "monthly":
        months_in_penalty = ceil(days_in_penalty / 30)
        fine = months_in_penalty * fine_per_day
        if fine_cap > 0: fine = min(fine, fine_cap)
    
    elif fine_type == "one_time":
        fine = fine_per_day  // it's a flat amount
```

Return `estimated_fine` as a computed field in every document API response.

---

### Priority 5: API Changes

#### Documents API — Updated Response Shape

Every document returned from the API should now include:

```json
{
  "id": "uuid",
  "employee_id": "uuid",
  "doc_type": "visa",
  "document_number": "UAE-VIS-123456",
  "issue_date": "2024-01-15",
  "expiry_date": "2026-01-15",
  "grace_period_days": 30,
  "fine_per_day": 50.00,
  "fine_type": "daily",
  "fine_cap": 0,
  "status": "valid",
  "is_mandatory": true,
  "metadata": { "visa_uid": "...", "visa_type": "employment", "sponsor": "XYZ Engineering" },
  "file_url": "/uploads/...",
  "estimated_fine": 0,
  "days_remaining": 334,
  "grace_days_remaining": null,
  "days_in_penalty": null,
  "created_at": "...",
  "updated_at": "..."
}
```

Computed fields (never stored, calculated on every read):
- `status` — based on the logic above
- `estimated_fine` — based on fine calculation logic
- `days_remaining` — days until expiry (negative if expired)
- `grace_days_remaining` — only populated when status is "in_grace"
- `days_in_penalty` — only populated when status is "penalty_active"

#### New API: Dashboard Stats

`GET /api/dashboard/stats`

```json
{
  "total_employees": 50,
  "total_documents": 350,
  "documents_by_status": {
    "incomplete": 45,
    "valid": 230,
    "expiring_soon": 35,
    "in_grace": 12,
    "penalty_active": 5
  },
  "total_daily_fine_exposure": 340.00,
  "total_accumulated_fines": 4500.00,
  "company_breakdown": [
    {
      "company_id": "uuid",
      "company_name": "XYZ Engineering",
      "employee_count": 30,
      "penalty_active_count": 3,
      "daily_exposure": 220.00,
      "accumulated_fines": 3200.00
    }
  ],
  "completion_rate": 87.1,
  "critical_alerts": [
    {
      "employee_id": "uuid",
      "employee_name": "Ahmed Ali",
      "company_name": "XYZ Engineering",
      "doc_type": "visa",
      "status": "penalty_active",
      "expiry_date": "2026-01-10",
      "days_in_penalty": 7,
      "estimated_fine": 350.00,
      "daily_rate": 50.00
    }
  ]
}
```

Optionally filter by `?company_id=uuid`.

#### New API: Dependency Check

`GET /api/employees/{id}/dependency-alerts`

```json
{
  "alerts": [
    {
      "severity": "critical",
      "blocking_doc": "passport",
      "blocked_doc": "visa",
      "message": "Passport expires on 2026-02-20, before Visa renewal window. Renew passport first.",
      "blocking_expiry": "2026-02-20",
      "blocked_expiry": "2026-06-15"
    }
  ]
}
```

Logic: For each dependency in `document_dependencies`, check if the blocking document's expiry_date is before the blocked document's expiry_date (or within 60 days of it). If so, generate an alert.

#### New API: Fine Exposure Report

`GET /api/reports/fine-exposure?company_id=uuid`

Returns a per-employee, per-document breakdown of all active fines and projected fines if documents expiring soon are not renewed.

---

### Priority 6: Frontend Changes

#### 6.1 — Employee Detail Page (employees/[id]/page.tsx)

**Profile Details Section — Show all fields:**
Display gender, DOB, nationality, passport number, native location, current location, salary (with company currency), employee status. Currently only shows "Status: Active". Use a clean two-column grid layout for these fields.

**Document Section — Replace single list with 7 mandatory cards + additional docs:**

Layout: A grid of 7 cards (2 or 3 columns on desktop, 1 on mobile). Each card represents one mandatory document type.

Card states:
- **Incomplete** (gray, dashed border): Shows document type name, "Not yet tracked" message, completion indicator, "Complete Document" button that opens the edit dialog pre-filled with the document type.
- **Valid** (green left border): Document type, number, expiry date, "X days remaining" in green, file preview icon, edit button.
- **Expiring Soon** (amber left border): Same as valid but "X days remaining" in amber, shows renewal prompt.
- **In Grace** (orange left border): "Expired — Grace Period", "X days of grace remaining", "No fine yet — renew immediately", edit button.
- **Penalty Active** (red left border): "Expired — Fine Active", "AED X/day accumulating", "Estimated fine: AED Y", "Z days overdue", urgency styling.

**Completion bar** at the top of the documents section: "5/7 mandatory documents tracked" with a progress bar.

**Dependency alerts section**: If any dependency alerts exist for this employee, show them as warning banners above the document grid. Example: "⚠ Passport expires before Visa renewal window — renew passport first."

**Additional Documents section**: Below the 7 mandatory cards. This is where trade license, NOC, educational certs, or any "Other" type documents appear. Keep the existing "+ Add Document" button here, but only for non-mandatory types.

#### 6.2 — Add Document Dialog Changes

For **mandatory document slots** (clicking "Complete Document" on an incomplete card), the dialog should:
- Pre-select the document type (non-editable, since the slot already exists)
- Show fields: Document Number (required), Issue Date (required), Expiry Date (required), File Upload (required)
- Show type-specific metadata fields based on doc_type:
  - Visa: Visa UID, Visa Type dropdown (Employment/Residence/Mission/Green/Golden), Sponsor (auto-fill from company)
  - Emirates ID: 15-digit EID Number, Linked Visa (auto-fill if visa exists)
  - Work Permit: Permit Number, MoHRE File Number, Job Title (auto-fill from employee trade)
  - Health Insurance: Policy Number, Insurer Name, Plan Type, Coverage Amount
  - ILOE: Category (A if salary <= 16000, B if > 16000 — auto-suggest based on employee salary), Subscription Status
  - Medical Fitness: Certificate Number, Test Result (Fit/Unfit)
  - Passport: Nationality (auto-fill from employee), Issuing Country

For **additional documents** ("+ Add Document" button), keep existing dialog but add Document Number and Issue Date fields.

#### 6.3 — Dashboard Changes (page.tsx)

**Add a Fine Exposure card** as the 5th metric card (or replace "Active Documents" since that's less useful):
- Show: "Fine Exposure"
- Value: "AED X,XXX" (total accumulated fines)
- Subtitle: "AED X/day accumulating"
- Red styling when > 0

**Update existing cards:**
- "Expiring Soon" should now include a subtitle showing how many are "In Grace" vs just "expiring"
- "Expired" card should show count of penalty_active documents

**Add completion rate** somewhere on the dashboard: "Document Compliance: 87% — 45 incomplete slots across all employees"

**Company breakdown section**: Below the charts, add a table or card grid showing each company's compliance posture:
- Company name, employee count, documents in penalty, daily exposure, accumulated fines

**Critical alerts list update**: Already exists, but enhance each alert row to show:
- Employee name, company, document type, status badge, days info, AND estimated fine amount

#### 6.4 — Company Dialog (companies/page.tsx)

Add these fields to the add/edit company dialog:
- Currency (dropdown: AED, USD, EUR, GBP, SAR, etc.) — default AED
- Trade License Number (text)
- Establishment Card Number (text)
- MoHRE Category (dropdown: Category 1, Category 2, Category 3)
- Regulatory Authority (dropdown: MOHRE, JAFZA, DMCC, DAFZA, DIFC, Other)

Display currency and regulatory authority on company cards.

#### 6.5 — Notification UI

Build the notification dropdown/page behind the existing bell icon:

- Bell icon shows unread count badge (red dot with number)
- Clicking opens a dropdown (or navigates to /notifications page)
- List of notifications: icon + message + timestamp + read/unread state
- "Mark all as read" action
- Each notification links to the relevant employee's detail page

Backend already has: list, count, mark read, mark all read APIs.

#### 6.6 — Employee List Enhancements

Add these filters (backend already supports them):
- **Nationality** filter dropdown
- **Employee Status** filter (Active / Inactive / On Leave)

Update the document status filter to include the new statuses:
- All, Incomplete, Valid, Expiring Soon, In Grace, Penalty Active, No Documents

#### 6.7 — Salary Label Fix

In the add employee form (`new/page.tsx`) and edit form (`edit/page.tsx`):
- Replace hardcoded "Salary (AED/month)" with dynamic label using the selected company's currency
- When company selection changes, update the salary label accordingly
- Fallback to "AED" if company has no currency set

---

### Priority 7: Notification Generation (Backend Cron)

Create a background job (Go goroutine with ticker, or cron) that runs daily:

```
For each employee:
  For each mandatory document:
    Calculate days until expiry
    
    if days == 90: create notification "90-day reminder: {doc_type} for {employee_name} expires on {date}"
    if days == 60: create notification "60-day reminder: ..."
    if days == 30: create notification "30-day URGENT: ..."
    if days == 15: create notification "15-day CRITICAL: ..."
    if days == 7: create notification "7-day FINAL WARNING: ..."
    
    if days < 0 and within grace:
      create daily notification "GRACE PERIOD: {doc_type} for {employee_name} — {grace_remaining} days of grace left"
    
    if days < 0 and past grace:
      create daily notification "FINE ACTIVE: {doc_type} for {employee_name} — AED {fine}/day accumulating. Total: AED {total}"
```

Deduplicate: don't create the same notification twice on the same day for the same document.

---

### Priority 8: Configurable Fine Rates

Grace periods and fine rates should be editable by admin without code changes.

Option A (simpler): Add a settings page `/settings/compliance` with a table showing all 7 document types and their grace_period_days, fine_per_day, fine_type, fine_cap. Admin can edit these. When a new employee is created, the current settings are used to populate the document slots.

Option B (simplest): Keep the defaults in code for now but ensure the per-document fields (grace_period_days, fine_per_day, etc.) are stored on each document record and editable via the document edit dialog. This way an admin can override per-document if needed.

**Go with Option B for now** — it's already handled by the schema changes. The document edit dialog should show these fields as "Advanced Settings" accordion for admin users.

---

## Data Flow Summary

```
Employee Created
  → 7 mandatory document slots auto-created (status: incomplete)
  → Dashboard shows "7 incomplete" for this employee
  → Completion: 0/7

User fills Passport details
  → Document updated: number, issue_date, expiry_date, file
  → Status computed: "valid" (if expiry > 30 days out)
  → Completion: 1/7

Time passes, Visa reaches 30-day window
  → Status changes to "expiring_soon"
  → Notification created at 30-day mark
  → Dashboard "Expiring Soon" count increments

Visa expires, enters grace period
  → Status: "in_grace"
  → Daily notification: "X grace days remaining"
  → Dashboard shows in grace count

Grace period ends, fine starts
  → Status: "penalty_active"
  → Fine calculated: days_in_penalty * fine_per_day
  → Dashboard "Fine Exposure" card shows amount
  → Daily notification with accumulated fine

User renews visa (updates expiry_date)
  → Status recomputed: "valid"
  → Fine stops accumulating
  → Notification: "Visa renewed for {employee_name}"
```

---

## File Changes Checklist

### Backend (Go)

- [ ] New migration: add columns to documents table
- [ ] New migration: add columns to companies table  
- [ ] New migration: create document_dependencies table with seed data
- [ ] New migration: create notification_preferences table
- [ ] Migration: merge labor_card → work_permit in existing documents
- [ ] Update employee creation handler: auto-create 7 mandatory doc slots
- [ ] Update document model: add all new fields
- [ ] Update document CRUD handlers: accept/return new fields including metadata
- [ ] Add document status computation logic (helper function)
- [ ] Add fine calculation logic (helper function)
- [ ] Add computed fields to document GET responses
- [ ] New handler: GET /api/dashboard/stats (with company breakdown + fine exposure)
- [ ] New handler: GET /api/employees/{id}/dependency-alerts
- [ ] New handler: GET /api/reports/fine-exposure
- [ ] Update company CRUD: accept/return currency, trade_license, establishment_card, mohre_category, regulatory_authority
- [ ] Add notification generation cron job
- [ ] One-time migration script: create missing mandatory doc slots for existing employees

### Frontend (Next.js)

- [ ] Employee detail page: show all profile fields in Profile Details section
- [ ] Employee detail page: replace document list with 7 mandatory cards grid
- [ ] Employee detail page: add completion progress bar
- [ ] Employee detail page: add dependency alerts section
- [ ] Employee detail page: separate "Additional Documents" section with Add button
- [ ] Update Add/Edit Document dialog: add document_number, issue_date fields
- [ ] Update Add/Edit Document dialog: add type-specific metadata fields
- [ ] Update Add/Edit Document dialog: for mandatory slots, pre-select type (non-editable)
- [ ] Dashboard: add Fine Exposure metric card
- [ ] Dashboard: add company-wise compliance breakdown
- [ ] Dashboard: update critical alerts to show fine amounts
- [ ] Dashboard: add completion rate indicator
- [ ] Company dialog: add currency, trade_license, establishment_card, mohre_category, regulatory_authority fields
- [ ] Company cards: display currency and regulatory authority
- [ ] Notification dropdown/page: build UI behind bell icon
- [ ] Employee list: add nationality filter
- [ ] Employee list: add employee status filter (active/inactive/on_leave)
- [ ] Employee list: update doc status filter options
- [ ] Salary label: dynamic currency based on selected company
- [ ] Replace any remaining alert() calls with toast()

---

## Document Type Display Names

Use these consistently across the UI:

| Internal Type | Display Name | Mandatory |
|---|---|---|
| `passport` | Passport | Yes |
| `visa` | Residence Visa | Yes |
| `emirates_id` | Emirates ID | Yes |
| `work_permit` | Work Permit / Labour Card | Yes |
| `health_insurance` | Health Insurance | Yes |
| `iloe_insurance` | ILOE Insurance | Yes |
| `medical_fitness` | Medical Fitness Certificate | Yes |
| `trade_license` | Trade License | No |
| `other` | Other | No |

---

## UAE Fine Quick Reference (for seed data / defaults) ( user can change also )

| Document | Grace Days | Fine/Day | Fine Type | Cap |
|---|---|---|---|---|
| Passport | 0 | 0 | N/A | N/A |
| Visa | 30 | 50 | daily | none |
| Emirates ID | 30 | 20 | daily | 1000 |
| Work Permit | 50 | 500 | one_time | 500 |
| Health Insurance | 30 | 500 | monthly | 150000 |
| ILOE Insurance | 0 | 400 | one_time | 400 |
| Medical Fitness | 0 | 0 | N/A | N/A |

---

## Notes 

- Do NOT create separate state management (Bloc/Cubit) — this is Next.js, use React hooks and server components where appropriate
- Keep code modular — separate the fine calculation logic, status computation, and dependency checking into their own utility files
- Use the existing API client pattern in `api.ts` for new endpoints
- Use existing toast (sonner) for all user feedback, never alert()
- All new UI components should follow existing dark theme + shadcn/ui patterns
- Make document cards responsive: 3 columns on desktop, 2 on tablet, 1 on mobile
- The metadata JSONB field keeps the schema clean — avoid creating separate tables for each document type's extra fields
- Grace periods and fines are stored per-document-record (not globally) so they can be overridden per case
- Status is always computed, never manually set by the user