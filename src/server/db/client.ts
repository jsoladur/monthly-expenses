import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// ============================================================================
// Database client (Drizzle + postgres-js)
//
// Single shared connection pool per process. Re-use the same client across
// server components, server actions, and tests so transactions see the same
// connection. The pool is configured for low concurrency because the workload
// is a single-user PWA (PRD §1, ADR-1).
// ============================================================================

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL && process.env.NODE_ENV !== "test") {
  throw new Error("DATABASE_URL is not set");
}

const isBuild = process.env.NEXT_PHASE === "phase-production-build";
const queryClient = postgres(DATABASE_URL ?? "postgres://localhost:5432/_placeholder", {
  // Build phase never opens a connection; defer until first query.
  prepare: false,
  max: isBuild ? 1 : 10,
  idle_timeout: 30,
  connect_timeout: 10,
});

export const db = drizzle(queryClient, { schema, logger: false });

export type Database = typeof db;
export { schema };
