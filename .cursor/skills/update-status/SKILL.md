---
name: update-status
description: Updates CURRENT_STATUS.md with recent changes. Use when the user or the agent has added a migration, changed deploy config, or shipped a feature and the status file should be updated so future chats have the correct state.
---

# Update status

Append to [CURRENT_STATUS.md](CURRENT_STATUS.md) so the next session or AI has accurate project state.

## When to use

- After adding a new migration (include new "Latest migration" and a short "Recent changes" line).
- After changing deploy or env (e.g. new service, new env var).
- After shipping a feature or fix worth recording for continuity.

## How to update

1. Open CURRENT_STATUS.md (project root).
2. **Latest migration:** If you added a migration, set the "Latest migration" line to the new filename (e.g. `011_new_feature.sql`).
3. **Recent changes:** Append 1–3 lines under "Recent changes (append here)" with:
   - Date (YYYY-MM-DD or YYYY-MM).
   - Short summary (e.g. "Added migration 011_allow_optional_field", "R2 bucket name updated").
4. **Last updated:** Update the "Last updated" date at the top.
5. Do not remove or rewrite existing entries; append only. Optionally trim very old entries if the list exceeds ~30.

## Format example

```markdown
## Recent changes (append here)

- 2026-02-28: Added CURRENT_STATUS.md and Cursor rules/skills.
- 2026-03-01: Added migration 011_allow_optional_field; updated Latest migration.
```

Keep entries concise so the file stays scannable and token-efficient.
