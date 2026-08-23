// ============================================================================
// Database migration entrypoint — runs at container start (Dockerfile CMD).
//
// Plain ESM JS so the runtime image needs no TypeScript toolchain. Uses the
// bundled Drizzle migrator (no drizzle-kit needed in production).
// Exits 0 on success, 1 on failure.
// ============================================================================

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
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
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
