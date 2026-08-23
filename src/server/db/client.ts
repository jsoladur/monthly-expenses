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
const isBuild = process.env.NEXT_PHASE === "phase-production-build";
const isTest = process.env.NODE_ENV === "test";

// The build phase (`next build`) imports every route module to collect page
// data, which transitively pulls in this client. We never open a connection
// during the build, so a missing DATABASE_URL is fine there — the placeholder
// URL below is only used if a query slips through. The runtime check still
// fails loudly the first time real code runs without a database.
if (!DATABASE_URL && !isTest && !isBuild) {
  throw new Error("DATABASE_URL is not set");
}

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
