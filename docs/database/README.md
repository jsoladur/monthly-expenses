# Database docs

| Path | What it is |
| --- | --- |
| [`database.dbml`](database.dbml) | Schema only (no rows). Workspace tenancy since migration 0008 (UC-31). |
| [`seed-ui-evaluation.sql`](seed-ui-evaluation.sql) | **Fake** demo data for UI evaluation. Generic names. Months 2018-01 … 2026-09; salaries ~10–15k EUR; about 80% have positive potential savings. Loads into the signed-in user's private workspace. |
| `prod/` (gitignored) | Local tenant dumps for restoring a private database. **Do not commit or push.** |

## Migration 0008 (UC-31, workspaces) — runbook

Migration 0008 changes tenancy from `user_id` to `workspace_id`. It is forward-only and is **not** safe as a rolling deploy:

1. **Stop both app instances** and keep them stopped until the new build runs (old code writes `user_id`, which 0008 drops).
2. **Take a full backup** and check it restores (`pg_dump` of the whole database, schema + data).
3. Start the new build; the migrator (`scripts/migrate.mjs`) applies 0008 once, in one transaction. It creates `workspace`, `workspace_member` and `workspace_invitation`, a private workspace + Owner membership for every `app_user`, re-points `category`, `template`, `annual`, `month` to it, fills `month_actual_expense.created_by_user_id`, and fails (rolling everything back) if any per-user row count changes.

## Migration 0009 (UC-32, ownership transfer)

0009 only creates the empty `workspace_transfer` table (no backfill, no change to existing rows). Code from before UC-32 never reads it, so it is safe to apply while the previous build is still running. Take the usual backup first.

## Restoring a tenant dump

To restore a dump in `prod/backup.sql`:

1. Apply migrations (`pnpm dev` or `node scripts/migrate.mjs`) so schema + `drizzle` ledger already exist.
2. Sign in once so exactly one `app_user` (+ `profile_settings` + its private `workspace` and `workspace_member`) exists.
3. `psql "$DATABASE_URL" -f docs/database/prod/backup.sql`

The dump is **data only** for catalog/money tables. It does **not** write `app_user`, `profile_settings`, `workspace`, `workspace_member`, `workspace_invitation`, `workspace_transfer` or `drizzle.__drizzle_migrations` — it remaps the dumped tenant ids onto the signed-in local user's **private workspace** (`workspace_id`) and dumped `created_by_user_id` values onto that user. Catalog/money tables must be empty or primary keys will collide.

The remap footer (post-0008 dump) must target `workspace_id`:

```sql
UPDATE category SET workspace_id = (SELECT id FROM workspace WHERE kind = 'private' LIMIT 1);
UPDATE template SET workspace_id = (SELECT id FROM workspace WHERE kind = 'private' LIMIT 1);
UPDATE annual   SET workspace_id = (SELECT id FROM workspace WHERE kind = 'private' LIMIT 1);
UPDATE month    SET workspace_id = (SELECT id FROM workspace WHERE kind = 'private' LIMIT 1);
UPDATE month_actual_expense SET created_by_user_id = (SELECT id FROM app_user LIMIT 1);
```

Load the data with constraints deferred (`SET session_replication_role = replica;` before the `COPY` blocks, `= DEFAULT` before the remap) so the dumped foreign ids do not fail the FKs before the remap. A **pre-0008** dump has `user_id` columns instead: restore it into a database at migration 0007, remap `user_id` to the local user, then let the migrator apply 0008.

To regenerate from a live database:

```bash
pg_dump --data-only --no-owner --no-privileges -n public \
  --exclude-table=app_user --exclude-table=profile_settings \
  --exclude-table=workspace --exclude-table=workspace_member \
  "$DATABASE_URL"
```

Then keep the file header + remap/`COMMIT` footer above; do not include the `drizzle` schema. A dump of a database with shared workspaces holds several workspaces' rows; this remap folds them all into one private workspace, so restore such a dump only into a database where that is what you want.
