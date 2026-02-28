---
name: add-migration
description: Adds a new numbered SQL migration to backend/migrations and updates CURRENT_STATUS. Use when the user wants to add a database migration or when schema/DDL changes are required.
---

# Add migration

Create a new migration file in the correct order and update project status.

## 1. Determine the next number

**Do not hardcode (e.g. 011).** The next number changes as the project grows.

- List migration files in `backend/migrations/` (e.g. 002–010, plus production_setup.sql which may be unnumbered).
- Take the **highest numeric prefix** (e.g. 010) and use **next** (011).
- Or read [CURRENT_STATUS.md](CURRENT_STATUS.md) "Latest migration" (e.g. `010_drop_deprecated_doc_cols.sql`) and use 011.

If the latest is 010, the new file is `011_snake_case_description.sql`. Later it will be 012, 013, etc.

## 2. Create the migration file

- **Path:** `backend/migrations/NNN_snake_case_name.sql` (e.g. `backend/migrations/011_add_employee_notes.sql`).
- **Content:** Plain SQL (DDL/DML). This project uses forward-only migrations (no separate down files). Prefer additive changes; avoid destructive changes without explicit backup/safety.

## 3. Run migrations

From the repository root or backend directory:

```bash
migrate -path backend/migrations -database "$DB_URL" up
```

If a Makefile exists in backend with `migrate-up`, ensure `DB_URL` or `DATABASE_URL` is set, then:

```bash
cd backend && make migrate-up
```

Use the same database URL as the running app (Neon: `DATABASE_URL` or equivalent `DB_*`).

## 4. Update CURRENT_STATUS.md

- Set **Latest migration** to the new filename (e.g. `011_add_employee_notes.sql`).
- Under **Recent changes**, append a line: date and "Added migration 011_add_employee_notes" (or equivalent).
- Update **Last updated** date.

You can invoke the **update-status** skill after this step, or perform the same edits manually.

## Summary

1. Resolve next migration number from `backend/migrations/` or CURRENT_STATUS.md.
2. Add `backend/migrations/NNN_description.sql`.
3. Run `migrate ... up` with the correct DB URL.
4. Update CURRENT_STATUS.md (Latest migration + Recent changes).
