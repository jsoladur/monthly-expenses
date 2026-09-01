# Database docs

| Path | What it is |
| --- | --- |
| [`database.dbml`](database.dbml) | Schema only (no rows). |
| [`seed-ui-evaluation.sql`](seed-ui-evaluation.sql) | **Fake** demo data for UI evaluation. Generic names and round amounts. |
| `prod/` (gitignored) | Local tenant dumps for restoring a private database. **Do not commit or push.** |

To restore a dump in `prod/backup.sql`:

1. Apply migrations (`pnpm dev` or `node scripts/migrate.mjs`) so schema + `drizzle` ledger already exist.
2. Sign in once so exactly one `app_user` (+ `profile_settings`) exists.
3. `psql "$DATABASE_URL" -f docs/database/prod/backup.sql`

The dump is **data only** for catalog/money tables. It does **not** write `app_user`, `profile_settings`, or `drizzle.__drizzle_migrations` — it remaps dumped `user_id` values onto the signed-in local user. Catalog/money tables must be empty or primary keys will collide.

To regenerate from a live database:

```bash
pg_dump --data-only --no-owner --no-privileges -n public \
  --exclude-table=app_user --exclude-table=profile_settings \
  "$DATABASE_URL"
```

Then keep the file header + remap/`COMMIT` footer from the existing dump; do not include the `drizzle` schema.
