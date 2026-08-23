import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { monthFixedLine } from "@/server/db/schema";
import {
  CategoryNotFoundError,
  createCategory,
  deactivateCategory,
} from "@/server/services/categories";
import { createTemplate } from "@/server/services/templates";
import { createMonth } from "@/server/services/months";
import {
  addMonthOnlyLine,
  deleteMonthLine,
  IncomeCategoryError,
  InactiveCategoryError,
  MonthLineNotFoundError,
  MonthNotFoundError,
  updateRemainingAmount,
} from "@/server/services/reserved-lines";

// ============================================================================
// UC-09 reserved lines (remaining, month-only) — integration
// (PRD §6.6 / §7.3 / §7.8 / UC-11 / UC-18 / UC-19, ARCH §5).
//
// Hits the real Postgres the migration suite created. Skipped (not failed)
// when the database is unreachable so `pnpm test` stays usable without
// Docker.
//
// Acceptance (PRD §15 #7, #17, #18, plus §6.6 / §7.3 / §7.8 / §13 / C15):
//   - updateRemainingAmount: only the line's `remaining_amount` is patched;
//     `original_amount` is NEVER touched. Allowed for BOTH committed and
//     estimated kinds (PRD §7.4 / §6.6). Zero and negative values are
//     accepted (PRD §7.4). The row must belong to a month owned by the user
//     (PRD §5.1). A missing line surfaces as MonthLineNotFoundError.
//   - addMonthOnlyLine: inserts with `origin = 'month_only'`, and
//     `remaining_amount = original_amount = amount` (PRD §6.6). The target
//     category must be ACTIVE EXPENSE-kind (PRD §6.6). The parent month
//     must belong to the user (PRD §5.1). Amount is a wire string that
//     becomes integer cents (ADR-5 / ARCH §8); negatives are allowed
//     (PRD §7.6 / UC-16).
//   - deleteMonthLine: HARD delete (PRD C15 / §13). The row is GONE from
//     the physical DB and from every subsequent read. NEVER touches the
//     source template (PRD §6.6 / §7.8) — month-only lines were never in
//     `template` in the first place, and cloned lines keep their template
//     sibling intact.
//   - Months never sync: an August remaining edit does NOT leak into
//     September (PRD §7.8, #18). An August month-only line does NOT appear
//     in a September created afterwards (PRD §7.8, #17). September's lines
//     are a snapshot of the user's ACTIVE templates at September creation
//     (PRD C17, §6.3, §7.8).
//   - Two tenants are isolated: each only sees / mutates their own
//     reserved lines (PRD §5.1, UC-17).
//   - Reserved-line CRUD never creates or mutates a template row
//     (PRD §6.6 / §7.8).
// ============================================================================

const reachable = await pingDatabase();

const suite = reachable ? describe : describe.skip;

suite("UC-09 reserved lines (remaining, month-only)", () => {
  beforeAll(async () => {
    await truncateAllTenantTables();
  });

  afterEach(async () => {
    await truncateAllTenantTables();
  });

  afterAll(async () => {
    await db.$client.end({ timeout: 1 });
  });

  it("updates remaining_amount on a cloned line, leaves original_amount untouched (PRD §6.6)", async () => {
    const userId = await seedUser("google-sub-uc09-remaining");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Groceries",
      amount: "400.00",
      kind: "estimated",
    });
    await createMonth(userId, { year: 2026, month: 8 });

    const workspace = await getMonthWorkspace(userId, 2026, 8);
    const line = workspace.lines[0]!;

    const updated = await updateRemainingAmount(userId, {
      lineId: line.id,
      remainingAmount: "350.00",
    });

    expect(updated.id).toBe(line.id);
    expect(updated.remainingAmount).toBe("350.00");
    // `original_amount` is the snapshot at clone time and MUST stay put.
    expect(updated.originalAmount).toBe("400.00");
    // `kind` + `origin` are immutable for the life of the row.
    expect(updated.kind).toBe("estimated");
    expect(updated.origin).toBe("cloned");
  });

  it("accepts zero and negative remaining values (PRD §7.4 / §7.6)", async () => {
    const userId = await seedUser("google-sub-uc09-zero-negative");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Groceries",
      amount: "400.00",
      kind: "estimated",
    });
    await createMonth(userId, { year: 2026, month: 8 });
    const line = (await getMonthWorkspace(userId, 2026, 8)).lines[0]!;

    const zero = await updateRemainingAmount(userId, {
      lineId: line.id,
      remainingAmount: "0.00",
    });
    expect(zero.remainingAmount).toBe("0.00");
    expect(zero.originalAmount).toBe("400.00");

    const negative = await updateRemainingAmount(userId, {
      lineId: line.id,
      remainingAmount: "-50.00",
    });
    expect(negative.remainingAmount).toBe("-50.00");
    expect(negative.originalAmount).toBe("400.00");
  });

  it("allows updating remaining on a COMMITTED line (PRD §6.6 / §7.4 — committed is not estimated-only)", async () => {
    const userId = await seedUser("google-sub-uc09-committed");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Mortgage",
      amount: "800.00",
      kind: "committed",
    });
    await createMonth(userId, { year: 2026, month: 8 });
    const line = (await getMonthWorkspace(userId, 2026, 8)).lines[0]!;
    expect(line.kind).toBe("committed");

    const updated = await updateRemainingAmount(userId, {
      lineId: line.id,
      remainingAmount: "750.00",
    });
    expect(updated.kind).toBe("committed");
    expect(updated.remainingAmount).toBe("750.00");
  });

  it("rejects updateRemainingAmount on a missing line with MonthLineNotFoundError (PRD §5.1)", async () => {
    const userId = await seedUser("google-sub-uc09-missing-line");

    await expect(
      updateRemainingAmount(userId, {
        lineId: "00000000-0000-0000-0000-000000000000",
        remainingAmount: "1.00",
      }),
    ).rejects.toBeInstanceOf(MonthLineNotFoundError);
  });

  it("rejects updateRemainingAmount when the line belongs to another tenant (PRD §5.1, UC-17)", async () => {
    const alice = await seedUser("google-sub-uc09-iso-alice-line");
    const bob = await seedUser("google-sub-uc09-iso-bob-line");
    const groceries = await createCategory(alice, { kind: "expense", name: "Groceries" });
    await createTemplate(alice, {
      categoryId: groceries.id,
      name: "Groceries",
      amount: "400.00",
      kind: "estimated",
    });
    await createMonth(alice, { year: 2026, month: 8 });
    const aliceLine = (await getMonthWorkspace(alice, 2026, 8)).lines[0]!;

    // Bob trying to edit Alice's line → not-found (no info leak).
    await expect(
      updateRemainingAmount(bob, {
        lineId: aliceLine.id,
        remainingAmount: "0.00",
      }),
    ).rejects.toBeInstanceOf(MonthLineNotFoundError);

    // And Alice's row stays untouched.
    const after = await getMonthWorkspace(alice, 2026, 8);
    expect(after.lines[0]!.remainingAmount).toBe("400.00");
    expect(after.lines[0]!.id).toBe(aliceLine.id);
  });

  it("adds a month-only line with origin='month_only' and remaining=original=amount (PRD §6.6)", async () => {
    const userId = await seedUser("google-sub-uc09-month-only");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    const created = await createMonth(userId, { year: 2026, month: 8 });

    const added = await addMonthOnlyLine(userId, {
      monthId: created.id,
      categoryId: groceries.id,
      name: "Birthday gift",
      amount: "30.00",
      kind: "estimated",
    });

    expect(added.monthId).toBe(created.id);
    expect(added.categoryId).toBe(groceries.id);
    expect(added.name).toBe("Birthday gift");
    expect(added.remainingAmount).toBe("30.00");
    expect(added.originalAmount).toBe("30.00");
    expect(added.kind).toBe("estimated");
    expect(added.origin).toBe("month_only");
    expect(added.observations).toBeNull();

    const workspace = await getMonthWorkspace(userId, 2026, 8);
    const list = workspace.lines.filter((l) => l.origin === "month_only");
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(added.id);
  });

  it("adds a month-only line with kind='committed' (PRD §6.6 — both kinds accepted)", async () => {
    const userId = await seedUser("google-sub-uc09-month-only-committed");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    const created = await createMonth(userId, { year: 2026, month: 8 });

    const added = await addMonthOnlyLine(userId, {
      monthId: created.id,
      categoryId: groceries.id,
      name: "One-off insurance",
      amount: "120.00",
      kind: "committed",
    });

    expect(added.kind).toBe("committed");
    expect(added.origin).toBe("month_only");
  });

  it("persists optional observations on a month-only line", async () => {
    const userId = await seedUser("google-sub-uc09-month-only-obs");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    const created = await createMonth(userId, { year: 2026, month: 8 });

    const added = await addMonthOnlyLine(userId, {
      monthId: created.id,
      categoryId: groceries.id,
      name: "Birthday gift",
      observations: "for Alice",
      amount: "30.00",
      kind: "estimated",
    });

    expect(added.observations).toBe("for Alice");
  });

  it("accepts a negative amount on a month-only line (PRD §7.6 / UC-16)", async () => {
    const userId = await seedUser("google-sub-uc09-month-only-negative");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    const created = await createMonth(userId, { year: 2026, month: 8 });

    const added = await addMonthOnlyLine(userId, {
      monthId: created.id,
      categoryId: groceries.id,
      name: "Refund",
      amount: "-10.00",
      kind: "estimated",
    });

    expect(added.remainingAmount).toBe("-10.00");
    expect(added.originalAmount).toBe("-10.00");
  });

  it("rejects an INCOME category on month-only lines with IncomeCategoryError (PRD §6.6, expense-only)", async () => {
    const userId = await seedUser("google-sub-uc09-month-only-income-cat");
    const created = await createMonth(userId, { year: 2026, month: 8 });
    const salary = await createCategory(userId, { kind: "income", name: "Salary" });

    await expect(
      addMonthOnlyLine(userId, {
        monthId: created.id,
        categoryId: salary.id,
        name: "Bad row",
        amount: "10.00",
        kind: "estimated",
      }),
    ).rejects.toBeInstanceOf(IncomeCategoryError);
  });

  it("rejects an INACTIVE expense category on month-only lines with InactiveCategoryError (PRD §6.6)", async () => {
    const userId = await seedUser("google-sub-uc09-month-only-inactive-cat");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    await deactivateCategory(userId, { id: groceries.id });
    const created = await createMonth(userId, { year: 2026, month: 8 });

    await expect(
      addMonthOnlyLine(userId, {
        monthId: created.id,
        categoryId: groceries.id,
        name: "Should fail",
        amount: "10.00",
        kind: "estimated",
      }),
    ).rejects.toBeInstanceOf(InactiveCategoryError);
  });

  it("rejects an unknown category id with CategoryNotFoundError (PRD §6.6)", async () => {
    const userId = await seedUser("google-sub-uc09-month-only-unknown-cat");
    const created = await createMonth(userId, { year: 2026, month: 8 });

    await expect(
      addMonthOnlyLine(userId, {
        monthId: created.id,
        categoryId: "00000000-0000-0000-0000-000000000000",
        name: "Bad",
        amount: "10.00",
        kind: "estimated",
      }),
    ).rejects.toBeInstanceOf(CategoryNotFoundError);
  });

  it("rejects a missing month with MonthNotFoundError (PRD §5.1)", async () => {
    const userId = await seedUser("google-sub-uc09-month-only-missing-month");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });

    await expect(
      addMonthOnlyLine(userId, {
        monthId: "00000000-0000-0000-0000-000000000000",
        categoryId: groceries.id,
        name: "Bad",
        amount: "10.00",
        kind: "estimated",
      }),
    ).rejects.toBeInstanceOf(MonthNotFoundError);
  });

  it("hard-deletes a cloned line and removes it from the DB (PRD C15, §6.6)", async () => {
    const userId = await seedUser("google-sub-uc09-delete-cloned");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Groceries",
      amount: "400.00",
      kind: "estimated",
    });
    await createMonth(userId, { year: 2026, month: 8 });
    const line = (await getMonthWorkspace(userId, 2026, 8)).lines[0]!;

    await deleteMonthLine(userId, { lineId: line.id });

    const workspace = await getMonthWorkspace(userId, 2026, 8);
    expect(workspace.lines).toHaveLength(0);

    const rows = await db
      .select()
      .from(monthFixedLine)
      .where(sql`id = ${line.id}`);
    expect(rows).toHaveLength(0);
  });

  it("hard-deletes a month-only line and removes it from the DB (PRD C15, §6.6)", async () => {
    const userId = await seedUser("google-sub-uc09-delete-month-only");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    const created = await createMonth(userId, { year: 2026, month: 8 });
    const added = await addMonthOnlyLine(userId, {
      monthId: created.id,
      categoryId: groceries.id,
      name: "One-off",
      amount: "30.00",
      kind: "estimated",
    });

    await deleteMonthLine(userId, { lineId: added.id });

    const workspace = await getMonthWorkspace(userId, 2026, 8);
    expect(workspace.lines).toHaveLength(0);

    const rows = await db
      .select()
      .from(monthFixedLine)
      .where(sql`id = ${added.id}`);
    expect(rows).toHaveLength(0);
  });

  it("deleting a line NEVER touches the source template (PRD §6.6 / §7.8)", async () => {
    const userId = await seedUser("google-sub-uc09-no-template-mutation");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    const template = await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Groceries",
      amount: "400.00",
      kind: "estimated",
    });
    await createMonth(userId, { year: 2026, month: 8 });
    const line = (await getMonthWorkspace(userId, 2026, 8)).lines[0]!;

    const before = await countTemplateRows();
    await updateRemainingAmount(userId, { lineId: line.id, remainingAmount: "350.00" });
    await deleteMonthLine(userId, { lineId: line.id });
    const after = await countTemplateRows();

    expect(after).toEqual(before);

    // And the source template itself is still queryable with the original
    // amount, not the edited 350.00 — proves the edit lived on the
    // month-instance clone only (PRD §6.6 / §7.8).
    const { findTemplateById } = await import("@/server/repositories/template");
    const reloaded = await findTemplateById(userId, template.id);
    expect(reloaded!.amount).toBe("400.00");
  });

  it("a one-off August line does NOT appear in a September created afterwards (PRD §7.8, #17)", async () => {
    const userId = await seedUser("google-sub-uc09-month-only-no-leak");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Mortgage",
      amount: "800.00",
      kind: "committed",
    });
    const august = await createMonth(userId, { year: 2026, month: 8 });

    // August gets a one-off 30.00 line.
    await addMonthOnlyLine(userId, {
      monthId: august.id,
      categoryId: groceries.id,
      name: "August birthday",
      amount: "30.00",
      kind: "estimated",
    });

    // September created from current templates (no 30.00 one-off in the kit).
    await createMonth(userId, { year: 2026, month: 9 });

    const augustWs = await getMonthWorkspace(userId, 2026, 8);
    const septemberWs = await getMonthWorkspace(userId, 2026, 9);

    expect(augustWs.lines.find((l) => l.name === "August birthday")).toBeDefined();
    expect(septemberWs.lines.find((l) => l.name === "August birthday")).toBeUndefined();

    // September's lines are exactly the templates active at September
    // creation (PRD C17).
    expect(septemberWs.lines).toHaveLength(1);
    expect(septemberWs.lines[0]!.name).toBe("Mortgage");
    expect(septemberWs.lines[0]!.origin).toBe("cloned");
  });

  it("editing August's remaining does NOT leak into September (PRD §7.8, #18)", async () => {
    const userId = await seedUser("google-sub-uc09-remaining-no-leak");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Groceries",
      amount: "400.00",
      kind: "estimated",
    });
    await createMonth(userId, { year: 2026, month: 8 });

    // Edit August's groceries remaining to 100.
    const augustLine = (await getMonthWorkspace(userId, 2026, 8)).lines[0]!;
    await updateRemainingAmount(userId, {
      lineId: augustLine.id,
      remainingAmount: "100.00",
    });

    // September cloned from the same template still has 400.00.
    await createMonth(userId, { year: 2026, month: 9 });
    const septemberWs = await getMonthWorkspace(userId, 2026, 9);
    const septemberGroceries = septemberWs.lines.find((l) => l.name === "Groceries")!;
    expect(septemberGroceries.remainingAmount).toBe("400.00");
    expect(septemberGroceries.originalAmount).toBe("400.00");
  });

  it("reserved-line CRUD never creates or mutates a template row (PRD §6.6 / §7.8)", async () => {
    const userId = await seedUser("google-sub-uc09-no-template-leak");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    const created = await createMonth(userId, { year: 2026, month: 8 });

    const before = await countTemplateRows();
    const added = await addMonthOnlyLine(userId, {
      monthId: created.id,
      categoryId: groceries.id,
      name: "One-off",
      amount: "10.00",
      kind: "estimated",
    });
    await updateRemainingAmount(userId, { lineId: added.id, remainingAmount: "5.00" });
    await deleteMonthLine(userId, { lineId: added.id });
    const after = await countTemplateRows();

    expect(after).toEqual(before);
  });

  it("two tenants are isolated: Alice's month-only lines never leak into Bob's month (PRD §5.1, UC-17)", async () => {
    const alice = await seedUser("google-sub-uc09-iso-alice-month-only");
    const bob = await seedUser("google-sub-uc09-iso-bob-month-only");
    const aliceGroceries = await createCategory(alice, { kind: "expense", name: "Groceries" });
    const bobGroceries = await createCategory(bob, { kind: "expense", name: "Groceries" });

    const aliceMonth = await createMonth(alice, { year: 2026, month: 8 });
    const bobMonth = await createMonth(bob, { year: 2026, month: 8 });

    const aliceLine = await addMonthOnlyLine(alice, {
      monthId: aliceMonth.id,
      categoryId: aliceGroceries.id,
      name: "Alice one-off",
      amount: "10.00",
      kind: "estimated",
    });
    const bobLine = await addMonthOnlyLine(bob, {
      monthId: bobMonth.id,
      categoryId: bobGroceries.id,
      name: "Bob one-off",
      amount: "20.00",
      kind: "estimated",
    });

    // Cross-tenant delete/update surfaces as not-found (no info leak).
    await expect(
      deleteMonthLine(alice, { lineId: bobLine.id }),
    ).rejects.toBeInstanceOf(MonthLineNotFoundError);
    await expect(
      updateRemainingAmount(alice, { lineId: bobLine.id, remainingAmount: "0.00" }),
    ).rejects.toBeInstanceOf(MonthLineNotFoundError);

    // Each tenant's list is untouched.
    const aliceWs = await getMonthWorkspace(alice, 2026, 8);
    const bobWs = await getMonthWorkspace(bob, 2026, 8);
    expect(aliceWs.lines.map((l) => l.id)).toEqual([aliceLine.id]);
    expect(bobWs.lines.map((l) => l.id)).toEqual([bobLine.id]);
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

async function getMonthWorkspace(userId: string, year: number, month: number) {
  const { getMonthWorkspace: service } = await import("@/server/services/months");
  return service(userId, year, month);
}

async function countTemplateRows(): Promise<{ n: string }[]> {
  return db.execute<{ n: string }>(sql`SELECT COUNT(*)::text AS n FROM template`);
}

async function pingDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch (err) {
    process.stderr.write(
      `[integration] Postgres unreachable, skipping UC-09 suite: ${(err as Error).message}\n`,
    );
    return false;
  }
}

async function truncateAllTenantTables(): Promise<void> {
  // month_fixed_line cascades from month; month cascades from app_user.
  await db.execute(sql`TRUNCATE TABLE app_user CASCADE`);
}
