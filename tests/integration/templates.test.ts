import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { template } from "@/server/db/schema";
import {
  CategoryNotFoundError,
  createCategory,
  deactivateCategory,
} from "@/server/services/categories";
import {
  InactiveCategoryError,
  IncomeCategoryError,
  TemplateAlreadyActiveError,
  TemplateAlreadyInactiveError,
  TemplateNotFoundError,
  createTemplate,
  deactivateTemplate,
  listActiveTemplates,
  listActiveTemplatesByKind,
  listTemplatesForManagement,
  reactivateTemplate,
  updateTemplate,
} from "@/server/services/templates";

// ============================================================================
// UC-05 fixed/estimated templates — integration (PRD §15 #11 + UC-07 / §6.3).
//
// Hits the real Postgres the migration suite created. Skipped (not failed)
// when the database is unreachable so `pnpm test` stays usable without
// Docker. The schema (UC-00) already exposes `template` and `category` with
// the FK + soft-delete columns the service relies on.
//
// Acceptance (PRD §6.3 / §13):
//   - createTemplate: kind ∈ {committed, estimated}; category must be an
//     ACTIVE expense category (income → IncomeCategoryError, inactive →
//     InactiveCategoryError); amount arrives as a "1234.56" string and is
//     persisted as integer cents via numeric(14,2); negatives allowed
//     (PRD §7.6).
//   - updateTemplate: only touches `name`/`observations`/`amount`/`kind` on
//     an existing template of the same tenant; never rewrites month rows
//     (PRD §6.3, §7.8).
//   - deactivateTemplate: soft delete (active=false, deleted_at=now()); the
//     clone query (`listActiveTemplatesByKind`) MUST exclude the row.
//   - reactivateTemplate: brings the row back; cannot reactivate a row that
//     points at a now-inactive category.
//   - listActiveTemplates: excludes inactive rows (used by UC-06 cloning).
//   - tenant isolation: Alice's templates never leak into Bob's lists
//     (PRD §5.1, UC-17).
// ============================================================================

const reachable = await pingDatabase();

const suite = reachable ? describe : describe.skip;

suite("UC-05 fixed/estimated templates", () => {
  beforeAll(async () => {
    await truncateAllTenantTables();
  });

  afterEach(async () => {
    await truncateAllTenantTables();
  });

  afterAll(async () => {
    await db.$client.end({ timeout: 1 });
  });

  it("creates a committed expense template with an active category and integer cents", async () => {
    const userId = await seedUser("google-sub-uc05-create");
    const groceries = await createCategory(userId, {
      kind: "expense",
      name: "Groceries",
    });

    const created = await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Weekly groceries",
      amount: "150.00",
      kind: "committed",
    });

    expect(created.userId).toBe(userId);
    expect(created.categoryId).toBe(groceries.id);
    expect(created.kind).toBe("committed");
    expect(created.amount).toBe("150.00");
    expect(created.active).toBe(true);
    expect(created.deletedAt).toBeNull();
  });

  it("accepts a negative amount (PRD §7.6) — the cents go to the DB unchanged", async () => {
    const userId = await seedUser("google-sub-uc05-negative");
    const groceries = await createCategory(userId, {
      kind: "expense",
      name: "Groceries",
    });

    const created = await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Cashback adjustment",
      amount: "-20.00",
      kind: "estimated",
    });

    expect(created.amount).toBe("-20.00");
    expect(created.kind).toBe("estimated");
  });

  it("rejects an INCOME category with IncomeCategoryError — templates are expense-only (PRD §6.3)", async () => {
    const userId = await seedUser("google-sub-uc05-income");
    const salary = await createCategory(userId, {
      kind: "income",
      name: "Salary",
    });

    await expect(
      createTemplate(userId, {
        categoryId: salary.id,
        name: "Template",
        amount: "100.00",
        kind: "committed",
      }),
    ).rejects.toBeInstanceOf(IncomeCategoryError);
  });

  it("rejects an INACTIVE category with InactiveCategoryError — soft-deleted categories stay retired", async () => {
    const userId = await seedUser("google-sub-uc05-inactive-cat");
    const groceries = await createCategory(userId, {
      kind: "expense",
      name: "Groceries",
    });
    await deactivateCategory(userId, { id: groceries.id });

    await expect(
      createTemplate(userId, {
        categoryId: groceries.id,
        name: "Template",
        amount: "100.00",
        kind: "committed",
      }),
    ).rejects.toBeInstanceOf(InactiveCategoryError);
  });

  it("rejects an unknown category id with CategoryNotFoundError (no leak across tenants)", async () => {
    const alice = await seedUser("google-sub-uc05-missing-alice");
    const bob = await seedUser("google-sub-uc05-missing-bob");
    const bobsCategory = await createCategory(bob, {
      kind: "expense",
      name: "Bob's groceries",
    });

    await expect(
      createTemplate(alice, {
        categoryId: bobsCategory.id,
        name: "Anything",
        amount: "50.00",
        kind: "committed",
      }),
    ).rejects.toBeInstanceOf(CategoryNotFoundError);
  });

  it("updates editable fields; deactivating the source category leaves the existing template intact (PRD §7.8)", async () => {
    const userId = await seedUser("google-sub-uc05-update");
    const groceries = await createCategory(userId, {
      kind: "expense",
      name: "Groceries",
    });
    const created = await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Weekly groceries",
      amount: "150.00",
      kind: "committed",
    });

    const updated = await updateTemplate(userId, {
      id: created.id,
      categoryId: groceries.id,
      name: "Weekly groceries + household",
      observations: "Includes cleaning supplies",
      amount: "175.50",
      kind: "estimated",
    });

    expect(updated.name).toBe("Weekly groceries + household");
    expect(updated.observations).toBe("Includes cleaning supplies");
    expect(updated.amount).toBe("175.50");
    expect(updated.kind).toBe("estimated");

    // Soft-deleting the source category is allowed (FK is ON DELETE RESTRICT
    // for hard delete only) and does NOT cascade to the template — the
    // historical template keeps its data. The service surfaces this via
    // InactiveCategoryError when a user tries to CREATE/UPDATE a template
    // targeting an inactive category, but existing rows are untouched.
    await deactivateCategory(userId, { id: groceries.id });
    const reread = await listTemplatesForManagement(userId, undefined);
    const stillThere = reread.find((t) => t.id === created.id);
    expect(stillThere).toBeDefined();
    expect(stillThere!.amount).toBe("175.50");
  });

  it("deactivate hides the row from the clone query but keeps it in the management list (PRD §6.3)", async () => {
    const userId = await seedUser("google-sub-uc05-deact");
    const groceries = await createCategory(userId, {
      kind: "expense",
      name: "Groceries",
    });
    const created = await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Weekly groceries",
      amount: "150.00",
      kind: "committed",
    });

    await deactivateTemplate(userId, { id: created.id });

    // Active list (used by UC-06 cloning) excludes the row.
    const activeAll = await listActiveTemplates(userId);
    expect(activeAll).toHaveLength(0);

    const activeCommitted = await listActiveTemplatesByKind(userId, "committed");
    expect(activeCommitted).toHaveLength(0);

    // Management list still shows it.
    const all = await listTemplatesForManagement(userId, "committed");
    expect(all).toHaveLength(1);
    expect(all[0]!.active).toBe(false);
    expect(all[0]!.deletedAt).toBeInstanceOf(Date);
  });

  it("deactivate then deactivate again throws TemplateAlreadyInactiveError", async () => {
    const userId = await seedUser("google-sub-uc05-deact-twice");
    const groceries = await createCategory(userId, {
      kind: "expense",
      name: "Groceries",
    });
    const created = await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Weekly groceries",
      amount: "150.00",
      kind: "committed",
    });

    await deactivateTemplate(userId, { id: created.id });
    await expect(deactivateTemplate(userId, { id: created.id })).rejects.toBeInstanceOf(
      TemplateAlreadyInactiveError,
    );
  });

  it("reactivate restores the row to the active clone query; double-reactivate throws TemplateAlreadyActiveError", async () => {
    const userId = await seedUser("google-sub-uc05-react");
    const groceries = await createCategory(userId, {
      kind: "expense",
      name: "Groceries",
    });
    const created = await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Weekly groceries",
      amount: "150.00",
      kind: "committed",
    });

    await deactivateTemplate(userId, { id: created.id });
    const reactivated = await reactivateTemplate(userId, { id: created.id });
    expect(reactivated.active).toBe(true);
    expect(reactivated.deletedAt).toBeNull();

    const active = await listActiveTemplatesByKind(userId, "committed");
    expect(active).toHaveLength(1);

    await expect(reactivateTemplate(userId, { id: created.id })).rejects.toBeInstanceOf(
      TemplateAlreadyActiveError,
    );
  });

  it("listActiveTemplatesByKind excludes the OTHER kind (clone baseline must be kind-specific, PRD §7.4)", async () => {
    const userId = await seedUser("google-sub-uc05-kind-bucket");
    const groceries = await createCategory(userId, {
      kind: "expense",
      name: "Groceries",
    });

    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Fixed weekly",
      amount: "150.00",
      kind: "committed",
    });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Estimate for the month",
      amount: "200.00",
      kind: "estimated",
    });

    const committed = await listActiveTemplatesByKind(userId, "committed");
    const estimated = await listActiveTemplatesByKind(userId, "estimated");
    expect(committed).toHaveLength(1);
    expect(committed[0]!.kind).toBe("committed");
    expect(estimated).toHaveLength(1);
    expect(estimated[0]!.kind).toBe("estimated");
  });

  it("two tenants are isolated: each only sees their own templates (PRD §5.1, UC-17)", async () => {
    const alice = await seedUser("google-sub-uc05-iso-alice");
    const bob = await seedUser("google-sub-uc05-iso-bob");

    const aliceCategory = await createCategory(alice, {
      kind: "expense",
      name: "Alice's groceries",
    });
    const bobCategory = await createCategory(bob, {
      kind: "expense",
      name: "Bob's groceries",
    });

    await createTemplate(alice, {
      categoryId: aliceCategory.id,
      name: "Alice's weekly",
      amount: "100.00",
      kind: "committed",
    });
    await createTemplate(bob, {
      categoryId: bobCategory.id,
      name: "Bob's weekly",
      amount: "300.00",
      kind: "committed",
    });

    const aliceTemplates = await listTemplatesForManagement(alice, "committed");
    const bobTemplates = await listTemplatesForManagement(bob, "committed");

    expect(aliceTemplates).toHaveLength(1);
    expect(bobTemplates).toHaveLength(1);
    expect(aliceTemplates[0]!.name).toBe("Alice's weekly");
    expect(bobTemplates[0]!.name).toBe("Bob's weekly");

    // Tenant ids must never appear in the other tenant's results.
    expect(aliceTemplates[0]!.userId).toBe(alice);
    expect(bobTemplates[0]!.userId).toBe(bob);

    // Cross-tenant update is invisible.
    await expect(
      updateTemplate(alice, {
        id: bobTemplates[0]!.id,
        categoryId: bobCategory.id,
        name: "Hacked",
        amount: "1.00",
        kind: "committed",
      }),
    ).rejects.toBeInstanceOf(TemplateNotFoundError);
  });

  it("no month money row is created or rewritten by template CRUD (PRD §6.3, §7.8)", async () => {
    const userId = await seedUser("google-sub-uc05-no-month-touch");
    const groceries = await createCategory(userId, {
      kind: "expense",
      name: "Groceries",
    });

    // Snapshot month-row counts before.
    const before = await countMonthRows(userId);

    const created = await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Weekly groceries",
      amount: "150.00",
      kind: "committed",
    });
    await updateTemplate(userId, {
      id: created.id,
      categoryId: groceries.id,
      name: "Weekly groceries (updated)",
      amount: "175.00",
      kind: "estimated",
    });
    await deactivateTemplate(userId, { id: created.id });
    await reactivateTemplate(userId, { id: created.id });

    const after = await countMonthRows(userId);
    expect(after).toEqual(before);
  });

  it("no physical DELETE ever runs on `template` (PRD §13)", async () => {
    const userId = await seedUser("google-sub-uc05-soft-delete-only");
    const groceries = await createCategory(userId, {
      kind: "expense",
      name: "Groceries",
    });
    const created = await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Weekly groceries",
      amount: "150.00",
      kind: "committed",
    });
    await deactivateTemplate(userId, { id: created.id });

    const rows = await db
      .select()
      .from(template)
      .where(sql`id = ${created.id}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.active).toBe(false);
    expect(rows[0]!.deletedAt).toBeInstanceOf(Date);
  });
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function seedUser(googleSub: string): Promise<string> {
  const [{ id }] = await db.execute<{ id: string }>(
    sql`INSERT INTO app_user (google_sub, email) VALUES (${googleSub}, ${`${googleSub}@example.com`}) RETURNING id`,
  );
  if (!id) {
    throw new Error("seedUser returned no id");
  }
  return id;
}

async function countMonthRows(userId: string): Promise<{
  month: number;
  month_income: number;
  month_fixed_line: number;
  month_actual_expense: number;
}> {
  const rows = await db.execute<{
    table_name: string;
    n: string;
  }>(sql`
    SELECT 'month' AS table_name, COUNT(*)::text AS n FROM month WHERE user_id = ${userId}
    UNION ALL
    SELECT 'month_income' AS table_name, COUNT(*)::text AS n
      FROM month_income WHERE month_id IN (SELECT id FROM month WHERE user_id = ${userId})
    UNION ALL
    SELECT 'month_fixed_line' AS table_name, COUNT(*)::text AS n
      FROM month_fixed_line WHERE month_id IN (SELECT id FROM month WHERE user_id = ${userId})
    UNION ALL
    SELECT 'month_actual_expense' AS table_name, COUNT(*)::text AS n
      FROM month_actual_expense WHERE month_id IN (SELECT id FROM month WHERE user_id = ${userId})
  `);
  const out = { month: 0, month_income: 0, month_fixed_line: 0, month_actual_expense: 0 };
  for (const row of rows) {
    const n = Number.parseInt(row.n, 10);
    if (row.table_name === "month") out.month = n;
    if (row.table_name === "month_income") out.month_income = n;
    if (row.table_name === "month_fixed_line") out.month_fixed_line = n;
    if (row.table_name === "month_actual_expense") out.month_actual_expense = n;
  }
  return out;
}

async function pingDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch (err) {
    process.stderr.write(
      `[integration] Postgres unreachable, skipping UC-05 suite: ${(err as Error).message}\n`,
    );
    return false;
  }
}

async function truncateAllTenantTables(): Promise<void> {
  // Template + category + profile_settings all cascade on app_user.
  await db.execute(sql`TRUNCATE TABLE app_user CASCADE`);
}
