import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { categoryKindEnum, lineKindEnum, lineOriginEnum } from "@/server/db/schema";

// ============================================================================
// Migration smoke test (UC-00 acceptance criteria).
//
// Connects to the compose Postgres. If it is unreachable, the suite is SKIPPED
// so `pnpm test` stays usable without Docker. The reachability probe is done
// at module-load time (top-level await) because `describe.skipIf` evaluates its
// argument synchronously at collection time — well before `beforeAll` runs.
// ============================================================================

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://expenses:expenses@db:5432/expenses";

const REQUIRED_TABLES = [
  "app_user",
  "profile_settings",
  "category",
  "template",
  "month",
  "month_income",
  "month_fixed_line",
  "month_actual_expense",
] as const;

const REQUIRED_ENUMS = [categoryKindEnum, lineKindEnum, lineOriginEnum] as const;

const probe = postgres(DATABASE_URL, { max: 1, connect_timeout: 3, idle_timeout: 5 });
const reachable = await probe`select 1`
  .then(() => true)
  .catch((err: Error) => {
    process.stderr.write(`[integration] Postgres unreachable, skipping smoke test: ${err.message}\n`);
    return false;
  });

const suite = reachable ? describe : describe.skip;

suite("schema smoke test (Postgres 16)", () => {
  it("contains the 8 domain tables from database.dbml", async () => {
    const rows = await probe<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
    `;
    const names = new Set(rows.map((r) => r.table_name));
    for (const required of REQUIRED_TABLES) {
      expect(names.has(required), `expected table "${required}" to exist`).toBe(true);
    }
  });

  it("contains the 3 enums (category_kind, line_kind, line_origin)", async () => {
    const rows = await probe<{ typname: string; enumlabel: string }[]>`
      SELECT t.typname, e.enumlabel
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
      ORDER BY t.typname, e.enumsortorder
    `;
    const byName = new Map<string, string[]>();
    for (const r of rows) {
      const list = byName.get(r.typname) ?? [];
      list.push(r.enumlabel);
      byName.set(r.typname, list);
    }
    for (const e of REQUIRED_ENUMS) {
      expect(byName.has(e.enumName), `expected enum "${e.enumName}" to exist`).toBe(true);
    }
    expect(byName.get("category_kind")?.sort()).toEqual(["expense", "income"]);
    expect(byName.get("line_kind")?.sort()).toEqual(["committed", "estimated"]);
    expect(byName.get("line_origin")?.sort()).toEqual(["cloned", "month_only"]);
  });

  it("enforces the partial unique index on (user_id, kind, name) WHERE active", async () => {
    const rows = await probe<{ indexdef: string }[]>`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'category_active_name_uk'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toMatch(/WHERE .*active.* = true/i);
  });

  it("enforces the CHECK (month BETWEEN 1 AND 12) constraint on month.month", async () => {
    const rows = await probe<{ conname: string; consrc: string }[]>`
      SELECT conname, pg_get_constraintdef(c.oid) AS consrc
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname = 'month' AND c.contype = 'c'
    `;
    const found = rows.find((r) => r.conname === "month_range_ck");
    expect(found, "expected month_range_ck check constraint").toBeDefined();
    // Postgres normalizes BETWEEN to >= / <= when stored.
    const text = found!.consrc.toLowerCase();
    expect(text).toMatch(/month\s*>=\s*1/);
    expect(text).toMatch(/month\s*<=\s*12/);
  });
});

afterAll(async () => {
  await probe.end({ timeout: 1 });
});
