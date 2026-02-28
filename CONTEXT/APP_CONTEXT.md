# App Context — Manpower Management System (Brief)

> **Use this for low-token injection.** Full details: [PROJECT_ANALYSIS.md](../PROJECT_ANALYSIS.md) and [CURRENT_STATUS.md](../CURRENT_STATUS.md). CONTEXT/ folder is legacy; prefer PROJECT_ANALYSIS and CURRENT_STATUS for current state.

## Stack

| Layer    | Tech                     | Hosting       |
| -------- | ------------------------ | ------------- |
| Frontend | Next.js 16, React 19, TS | Vercel        |
| Backend  | Go, Chi router           | Render        |
| Database | PostgreSQL               | Neon          |
| Storage  | S3-compatible            | Cloudflare R2 |
| Auth     | JWT                      | —             |

## Key paths

- **Backend:** `backend/cmd/api/main.go` (entry, routes), `backend/internal/handlers/` (auth, employee, document, dashboard, admin, upload, etc.), `backend/internal/models/`, `backend/internal/config/`, `backend/internal/storage/` (local + R2), `backend/internal/compliance/`, `backend/internal/cron/`, `backend/migrations/`.
- **Frontend:** `frontend/src/app/` (App Router pages), `frontend/src/lib/api.ts` (API client), `frontend/src/components/`, `frontend/src/types/`.
- **Config / context:** `PROJECT_ANALYSIS.md` (canonical), `CURRENT_STATUS.md` (incremental status; update when you change migrations or deploy).

## Environment

- **Vercel:** `NEXT_PUBLIC_API_URL` → Render backend URL.
- **Render:** `DATABASE_URL` or `DB_*` (Neon), `JWT_SECRET`, `FRONTEND_URL` (Vercel), `STORAGE=r2`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`.
- **Neon:** Connection string in `DATABASE_URL` (or split as DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME/DB_SSLMODE). Use same URL for `migrate` (e.g. Makefile `DB_URL` or `DATABASE_URL`).

## Migrations

- Location: `backend/migrations/`. Numbered `NNN_snake_case_name.sql` (e.g. `010_drop_deprecated_doc_cols.sql`).
- **Next number:** List `backend/migrations/*.sql` or read CURRENT_STATUS.md “Latest migration”; use next sequential (011, 012, …). Do not hardcode.
- Run: from backend dir, `migrate -path migrations -database "$DB_URL" up` (or `make migrate-up` if Makefile present; set DB_URL/DATABASE_URL).
- After adding a migration, append to CURRENT_STATUS.md with date and new “Latest migration”.

## Roles (backend)

- Protected routes: JWT required; many require `company_owner` or `admin` (see `backend/cmd/api/main.go` for exact middleware: `RequireMinRole("company_owner")`, `RequireMinRole("admin")`).

## Where to look for what

- **API routes and handlers:** PROJECT_ANALYSIS.md §6 and §8; `backend/cmd/api/main.go`.
- **Schema and tables:** PROJECT_ANALYSIS.md §5; migrations in `backend/migrations/`.
- **Document compliance (status, grace, fines):** PROJECT_ANALYSIS.md §10; `backend/internal/compliance/`.
- **Frontend pages and API client:** PROJECT_ANALYSIS.md §7; `frontend/src/app/`, `frontend/src/lib/api.ts`.
