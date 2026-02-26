# Manpower Management System — Project Analysis

> **Live Production:** [https://manpower-management-system.vercel.app](https://manpower-management-system.vercel.app/settings)  
> **Last Updated:** February 2026

---

## 1. Executive Summary

The **Manpower Management System** is a full-stack web application for tracking employees across companies and managing UAE document compliance. It targets contracting/manpower supply businesses that need to avoid fines from expired visas, Emirates IDs, work permits, and other mandatory documents.

| Aspect | Technology |
|--------|------------|
| **Frontend** | Next.js 16 (React 19) on Vercel |
| **Backend** | Go (Chi router) on Render |
| **Database** | PostgreSQL (Neon) |
| **File Storage** | Cloudflare R2 (S3-compatible) |
| **Auth** | JWT-based |

---

## 2. Production Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (Browser)                                │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │ HTTPS
┌─────────────────────────────────────▼───────────────────────────────────────┐
│                    VERCEL (Next.js 16)                                        │
│  manpower-management-system.vercel.app                                        │
│  • Static + SSR pages                                                         │
│  • NEXT_PUBLIC_API_URL → Render backend                                       │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │ REST API (Bearer JWT)
┌─────────────────────────────────────▼───────────────────────────────────────┐
│                    RENDER (Go API)                                            │
│  • Chi router, JWT auth, rate limiting                                        │
│  • CORS: localhost + FRONTEND_URL (Vercel)                                    │
└───────┬─────────────────────┬─────────────────────┬──────────────────────────┘
        │                     │                     │
        │                     │                     │
┌───────▼──────┐    ┌─────────▼─────────┐    ┌──────▼──────────┐
│ NEON         │    │ CLOUDFLARE R2     │    │ (Future: SES)    │
│ PostgreSQL   │    │ Object Storage    │    │ Email alerts     │
│              │    │ • Documents       │    │                  │
│ • companies  │    │ • Employee photos │    │                  │
│ • employees  │    │ • S3-compatible   │    │                  │
│ • documents  │    │ • Public CDN URLs │    │                  │
│ • users      │    │                   │    │                  │
│ • salary     │    │                   │    │                  │
│ • etc.       │    │                   │    │                  │
└──────────────┘    └───────────────────┘    └──────────────────┘
```

**Data Flow:**
- Frontend calls `NEXT_PUBLIC_API_URL` (Render) with `Authorization: Bearer <token>`
- Backend uses `DATABASE_URL` (Neon) for all persistence
- When `STORAGE=r2`, uploads go to Cloudflare R2; files are served via public R2 URLs (CDN)
- Render’s local disk is ephemeral; R2 ensures files survive redeploys

---

## 3. Modules & Features

### 3.1 Module Map

| Module | Frontend Route | Backend Handlers | Purpose |
|--------|-----------------|------------------|---------|
| **Auth** | `/login`, `/register` | `auth.go` | Login, register, JWT, `/api/auth/me` |
| **Dashboard** | `/` | `dashboard.go` | Metrics, expiry alerts, compliance stats |
| **Employees** | `/employees`, `/employees/new`, `/employees/[id]`, `/employees/[id]/edit` | `employee.go` | CRUD, list, filter, export |
| **Companies** | `/companies` | `company.go` | CRUD for companies |
| **Documents** | (nested under employee) | `document.go` | CRUD, renew, primary toggle |
| **Salary** | `/salary` | `salary.go` | Generate, list, status, export |
| **Activity** | `/activity` | `activity.go` | Audit log |
| **Notifications** | (header bell) | `notification.go` | List, count, mark read |
| **Users** (admin) | `/users` | `user_management.go` | List, update role, delete |
| **Settings** (admin) | `/settings` | `admin.go` | Document types, compliance rules |
| **File Upload** | (forms) | `upload.go` | Multipart upload → R2/local |

### 3.2 Feature Summary

| Feature | Description | Access |
|---------|-------------|--------|
| **Dashboard** | Total employees, active/expiring/expired docs, completion %, fine exposure, charts, critical alerts | All authenticated |
| **Employee Management** | Add/edit/delete employees, batch delete, exit tracking, filter by company/trade/status | Admin write; all read |
| **Document Management** | 7 mandatory UAE doc types, custom types, expiry tracking, grace period, fine calculation | Admin write; all read |
| **Document Renewal** | Renew flow with new file, dates, metadata | Admin |
| **Compliance Engine** | Status: incomplete, valid, expiring_soon, in_grace, penalty_active; fine estimation | All |
| **Dependency Alerts** | Passport→Visa, Health→Work Permit, etc. | All |
| **Salary** | Generate by month/year, pending/paid/partial, export CSV | Admin write; all read |
| **Companies** | Multi-company support, currency, MOHRE fields | Admin |
| **Notifications** | In-app bell, daily cron for expiring/expired docs | All |
| **Activity Log** | Audit trail for key actions | All |
| **User Management** | List users, change role (admin/viewer), delete | Admin |
| **Settings** | Document types CRUD, compliance rules (grace, fine, mandatory) | Admin |

---

## 4. Feature Flow & Linking

### 4.1 Authentication Flow

```
User → /login → POST /api/auth/login
  → Backend validates credentials
  → Returns JWT
  → Frontend stores token in localStorage
  → AuthContext provides user to app
  → Protected routes check user; redirect to /login if null
```

### 4.2 Document Lifecycle Flow

```
                    ┌─────────────────┐
                    │   incomplete     │  (no file / missing fields)
                    └────────┬────────┘
                             │ file + dates added
                             ▼
                    ┌─────────────────┐
                    │     valid       │  (expiry > 30 days)
                    └────────┬────────┘
                             │ expiry approaches
                             ▼
                    ┌─────────────────┐
                    │ expiring_soon   │  (≤ 30 days)
                    └────────┬────────┘
                             │ expiry date passes
                             ▼
                    ┌─────────────────┐
                    │   in_grace      │  (within grace period)
                    └────────┬────────┘
                             │ grace ends
                             ▼
                    ┌─────────────────┐
                    │ penalty_active  │  (fines accumulating)
                    └─────────────────┘
```

### 4.3 Document Upload Flow

```
1. User selects file in Add Document / Renew dialog
2. Frontend validates (type, size)
3. POST /api/upload (multipart) → Backend
4. Backend: storage.Save() → R2 or local disk
5. Returns { url, fileName, fileSize, fileType }
6. Frontend submits document metadata (incl. file_url) to POST /api/employees/{id}/documents
7. Backend saves to documents table
8. UI refreshes document list
```

### 4.4 Dashboard → Employee → Document Linking

```
Dashboard
  ├─ Metric cards → /employees?status=...
  ├─ Expiry alerts → /employees/{employeeId} (document section)
  └─ Company compliance table → /employees?company_id=...

Employee List (/employees)
  ├─ Row click → /employees/{id}
  ├─ Add Employee → /employees/new
  └─ Edit → /employees/{id}/edit

Employee Detail (/employees/[id])
  ├─ Documents section
  │   ├─ Add Document (dialog)
  │   ├─ Edit / Renew / Delete per document
  │   └─ View file → opens file_url (R2 CDN)
  └─ Dependency alerts (from /api/employees/{id}/dependency-alerts)
```

### 4.5 Notification Flow

```
Cron (every 24h)
  → Query documents expiring within 30 days or expired
  → For each: compute status (expiring_soon, in_grace, penalty_active)
  → Insert notification for company owner (user_id)
  → De-duplicate by (user_id, entity_type, entity_id, date)

Frontend
  → Poll /api/notifications/count every 30s
  → Bell shows badge
  → Dropdown lists notifications (links to employee page)
  → Mark read / Mark all read
```

---

## 5. Database Schema (Neon PostgreSQL)

### 5.1 Core Tables

| Table | Purpose |
|-------|---------|
| `companies` | Company name, currency, MOHRE fields, user_id |
| `employees` | Name, trade, mobile, joining_date, company_id, status, exit fields, salary |
| `documents` | document_type, expiry_date, file_url, grace_period_days, fine_per_day, fine_type, fine_cap, is_mandatory, metadata |
| `users` | email, password_hash, name, role (admin/viewer) |
| `document_types` | doc_type, display_name, is_mandatory, metadata_fields (admin-configurable) |
| `compliance_rules` | company_id (null=global), doc_type, grace_period_days, fine_per_day, fine_type, fine_cap |
| `document_dependencies` | blocking_doc_type → blocked_doc_type (e.g. passport→visa) |
| `salary_records` | employee_id, month, year, amount, status |
| `notifications` | user_id, title, message, type, entity_type, entity_id, read |
| `activity_log` | user_id, action, entity_type, entity_id, details (JSONB) |

### 5.2 Relationships

```
users (1) ──────< companies (many)
companies (1) ──< employees (many)
employees (1) ──< documents (many)
employees (1) ──< salary_records (many)
users (1) ──────< notifications (many)
```

---

## 6. API Structure

### 6.1 Route Groups

| Group | Auth | Rate Limit | Description |
|-------|------|------------|-------------|
| Public | None | — | `/`, `/api/health` |
| Auth (login) | None | 5 req / 12s | `POST /api/auth/login` |
| Auth (register) | None | 3 req / 20s | `POST /api/auth/register` |
| Files | None | — | `GET /api/files/*` (serve/redirect) |
| Protected | JWT | — | All `/api/*` below |
| Admin-only | JWT + role=admin | — | Companies/Employees/Documents/Salary/Users/Settings write |

### 6.2 Key Endpoints

| Method | Endpoint | Handler | Role |
|--------|----------|---------|------|
| GET | `/api/dashboard/metrics` | dashboard | All |
| GET | `/api/dashboard/expiring` | dashboard | All |
| GET | `/api/dashboard/compliance` | dashboard | All |
| GET | `/api/employees` | employee | All |
| POST | `/api/employees` | employee | Admin |
| GET | `/api/employees/{id}/documents` | document | All |
| POST | `/api/employees/{id}/documents` | document | Admin |
| POST | `/api/documents/{id}/renew` | document | Admin |
| POST | `/api/upload` | upload | All (auth) |
| GET | `/api/notifications` | notification | All |
| GET | `/api/admin/document-types` | admin | All (read) |
| POST | `/api/admin/document-types` | admin | Admin |
| PUT | `/api/admin/compliance-rules` | admin | Admin |

---

## 7. Frontend Structure

### 7.1 App Router Pages

```
src/app/
├── page.tsx              # Dashboard
├── layout.tsx            # Root layout (ThemeProvider, AuthProvider, AppLayout)
├── login/page.tsx
├── register/page.tsx
├── employees/
│   ├── page.tsx          # List
│   ├── new/page.tsx      # Add employee
│   └── [id]/
│       ├── page.tsx      # Detail + documents
│       └── edit/page.tsx # Edit employee
├── companies/page.tsx
├── salary/page.tsx
├── activity/page.tsx
├── users/page.tsx        # Admin
└── settings/page.tsx     # Admin: compliance rules, document types
```

### 7.2 Key Libraries

| Library | Use |
|---------|-----|
| React Query (@tanstack/react-query) | Data fetching, cache |
| React Hook Form + Zod | Forms, validation |
| Recharts | Dashboard charts |
| Lucide React | Icons |
| Sonner | Toasts |
| next-themes | Dark/light mode |
| shadcn/ui (Radix) | UI components |

---

## 8. Backend Structure

### 8.1 Package Layout

```
backend/
├── cmd/api/main.go       # Entry, router, middleware, handler wiring
├── internal/
│   ├── config/           # Env config
│   ├── database/         # pgxpool, health
│   ├── handlers/         # HTTP handlers (auth, employee, document, etc.)
│   ├── middleware/      # Auth, rate limit
│   ├── models/           # Structs for DB rows
│   ├── storage/          # Store interface, local.go, r2.go
│   ├── compliance/       # Status, fine, grace logic
│   ├── cron/             # Notifier (24h cycle)
│   └── ctxkeys/          # Context keys
└── migrations/           # SQL migrations
```

### 8.2 Storage Abstraction

```go
type Store interface {
    Save(ctx, path, file, contentType) (*FileInfo, error)
    Delete(ctx, path) error
    URL(path string) string
}
```

- **Local:** `./uploads`, served via `/api/files/*`
- **R2:** S3-compatible, public URLs via `R2_PUBLIC_URL` (CDN)

---

## 9. Deployment Configuration

### 9.1 Environment Variables

| Service | Key Variables |
|---------|---------------|
| **Vercel** | `NEXT_PUBLIC_API_URL` (Render URL) |
| **Render** | `DATABASE_URL` (Neon), `JWT_SECRET`, `FRONTEND_URL` (Vercel), `STORAGE=r2`, `R2_*` |
| **Neon** | Connection string in `DATABASE_URL` |
| **R2** | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL` |

### 9.2 Production Checklist

- [x] Frontend on Vercel
- [x] Backend on Render (Go)
- [x] Database on Neon (PostgreSQL)
- [x] Files on Cloudflare R2
- [x] CORS configured for Vercel origin
- [x] JWT auth with secret
- [x] Rate limiting on login/register
- [x] Cron notifier for document alerts

---

## 10. Compliance & Business Logic

### 10.1 Document Status (Computed)

| Status | Condition |
|--------|-----------|
| `incomplete` | Missing file or required fields |
| `valid` | Expiry > 30 days away |
| `expiring_soon` | Expiry ≤ 30 days |
| `in_grace` | Past expiry, within grace period |
| `penalty_active` | Past expiry + grace; fines apply |

### 10.2 Fine Calculation

- **daily:** `fine_per_day × days_past_grace` (capped by `fine_cap` if set)
- **monthly:** `fine_per_day` as monthly rate
- **one_time:** Flat `fine_per_day` when past grace

### 10.3 Mandatory Document Types (UAE)

Passport, Residence Visa, Emirates ID, Work Permit, Health Insurance, ILOE Insurance, Medical Fitness. Configurable per company via `compliance_rules` and `document_types`.

---

## 11. Summary

The Manpower Management System is a production-ready, multi-tenant compliance tracking app with:

- **Clear separation:** Next.js frontend, Go API, Neon Postgres, R2 storage
- **Role-based access:** Admin (full) vs Viewer (read-only)
- **UAE-focused compliance:** 7 mandatory doc types, grace periods, fine estimation
- **Automated alerts:** Daily cron → in-app notifications
- **Scalable storage:** R2 for persistent files across Render redeploys

All major features are implemented and linked: Dashboard → Employees → Documents → Renewal, with Settings for document types and compliance rules.
