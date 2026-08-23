// ============================================================================
// Database migration entrypoint — runs at container start (Dockerfile CMD).
//
// Plain ESM JS so the runtime image needs no TypeScript toolchain. Uses the
// bundled Drizzle migrator (no drizzle-kit needed in production).
//
// Why this looks simple: Drizzle's `migrate()` already wraps each migration in
// its own Postgres transaction (see drizzle-orm/postgres-js/migrator). If a
// migration is interrupted (container killed, OOM, connection drop), Postgres
// rolls the partial state back so the schema and the __drizzle_migrations
// journal row commit together or not at all.
//
// Exits 0 on success, 1 on failure.
// ============================================================================

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { readFileSync } from "fs";
import { resolve } from "path";

let url = process.env.DATABASE_URL;
if (!url) {
  try {
    const envPath = resolve(process.cwd(), ".env");
    const envContent = readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const match = line.match(/^DATABASE_URL=(.+)$/);
      if (match) {
        url = match[1].trim();
        break;
      }
    }
  } catch {}
}
if (!url) {
  console.error("[migrate] DATABASE_URL is not set");
  process.exit(1);
}

const client = postgres(url, { max: 1, prepare: false });
const db = drizzle(client);

try {
  process.stdout.write("[migrate] applying Drizzle migrations…\n");
  await migrate(db, { migrationsFolder: "./drizzle" });
  process.stdout.write("[migrate] OK\n");
} catch (err) {
  process.stderr.write(`[migrate] FAILED: ${err.message}\n`);
  if (err.detail) process.stderr.write(`  Detail: ${err.detail}\n`);
  if (err.hint) process.stderr.write(`  Hint: ${err.hint}\n`);
  if (err.position) process.stderr.write(`  Position: ${err.position}\n`);
  if (err.where) process.stderr.write(`  Where: ${err.where}\n`);
  if (err.schema) process.stderr.write(`  Schema: ${err.schema}\n`);
  if (err.table) process.stderr.write(`  Table: ${err.table}\n`);
  if (err.column) process.stderr.write(`  Column: ${err.column}\n`);
  if (err.constraint) process.stderr.write(`  Constraint: ${err.constraint}\n`);
  if (Array.isArray(err.cause?.issues)) {
    for (const issue of err.cause.issues) {
      process.stderr.write(`  - ${issue.message}\n`);
    }
  }
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
