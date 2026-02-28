# Manpower Management System — Agent Instructions

This project is a full-stack **UAE document compliance** app: employees, companies, mandatory documents, expiry tracking, grace periods, fines. Frontend (Next.js 16) on Vercel, backend (Go/Chi) on Render, PostgreSQL on Neon, files on Cloudflare R2.

## Context files (read these)

- **Current state and recent work:** [CURRENT_STATUS.md](CURRENT_STATUS.md) — deploy state, latest migration number, recent changes. **Update this file** when you add migrations or change deploy/features.
- **Full reference:** [PROJECT_ANALYSIS.md](PROJECT_ANALYSIS.md) — architecture, schema, API, flows, modules.
- **Short brief:** [CONTEXT/APP_CONTEXT.md](CONTEXT/APP_CONTEXT.md) — stack, paths, env, migrations (for low-token injection).

The `CONTEXT/` folder has older docs; prefer **PROJECT_ANALYSIS.md** and **CURRENT_STATUS.md** for up-to-date info.

## When you change things

- **New migration:** Add file in `backend/migrations/` with **next** number (see CURRENT_STATUS.md or list existing migrations; e.g. after 010 use 011). Then run migrations (e.g. `migrate -path backend/migrations -database "$DB_URL" up`). Then **append** to CURRENT_STATUS.md: date, “Added migration 011_short_name”, and set “Latest migration” to the new file.
- **Deploy or feature change:** Append 1–3 lines to CURRENT_STATUS.md “Recent changes” with date and summary.

## Paths

- Backend: `backend/cmd/api/main.go`, `backend/internal/handlers/`, `backend/internal/models/`, `backend/migrations/`.
- Frontend: `frontend/src/app/`, `frontend/src/lib/api.ts`, `frontend/src/components/`.

## Cursor

- Follow project rules in `.cursor/rules/` (project-context is always applied; backend, frontend, migrations apply when relevant).
- Use `.cursor/skills/` when needed (e.g. `update-status`, `add-migration`).
