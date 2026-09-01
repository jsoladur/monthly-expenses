# Database docs

| Path | What it is |
| --- | --- |
| [`database.dbml`](database.dbml) | Schema only (no rows). |
| [`seed-ui-evaluation.sql`](seed-ui-evaluation.sql) | **Fake** demo data for UI evaluation. Generic names and round amounts. |
| `prod/` (gitignored) | Local tenant dumps for restoring a private database. **Do not commit or push.** |

To restore a dump in `prod/backup.sql`: migrate the schema, sign in once so one `app_user` exists, then `psql "$DATABASE_URL" -f docs/database/prod/backup.sql`.
