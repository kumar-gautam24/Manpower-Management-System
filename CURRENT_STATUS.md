# Current Status — Manpower Management System

> **Purpose:** Append-only project state so any new chat or AI IDE has current context. When you change migrations, deploy config, or ship features, append a 1–3 line entry below. Do not remove old entries; trim only very old ones if the file grows large (e.g. keep last 30).

---

**Last updated:** 2026-02-28

## Deploy state

- **Database:** Neon PostgreSQL — live; migrations applied through **010**.
- **Backend:** Render (Go/Chi API).
- **Frontend:** Vercel (Next.js 16).
- **Storage:** Cloudflare R2 (documents, employee photos); public CDN URLs.

## Latest migration

- `010_drop_deprecated_doc_cols.sql` — dropped deprecated document columns (grace/fine/mandatory now from compliance_rules/document_types).

## Recent changes (append here)

- 2026-02: Production live (Vercel, Render, Neon, R2); role system (009), document rework (008), admin settings (007); compliance and settings in place.
- 2026-02-28: Added CURRENT_STATUS.md and Cursor rules/skills for AI/LLM context; PROJECT_ANALYSIS.md is canonical reference.
