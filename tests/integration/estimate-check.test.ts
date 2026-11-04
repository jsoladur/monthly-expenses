import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { createCategory } from "@/server/services/categories";
import { createTemplate } from "@/server/services/templates";
import { createMonth, MonthNotFoundError } from "@/server/services/months";
import { addIncome } from "@/server/services/incomes";
import { addActual } from "@/server/services/actuals";
import { addMonthOnlyLine } from "@/server/services/reserved-lines";
import { getMonthSummary } from "@/server/services/summary";
import { passToActual } from "@/server/services/pass-to-actual";
import {
  applyEstimateSuggestion,
  EstimateCategoryNotFoundError,
  getEstimateCheck,
} from "@/server/services/estimate-check";

// ============================================================================
// UC-25 estimate check — integration (proposed PRD §15 #47–#51, C25).
//
// Skipped (not failed) when Postgres is unreachable, like the other suites.
// ============================================================================

const reachable = await pingDatabase();

const suite = reachable ? describe : describe.skip;

suite("UC-25 estimate check", () => {
  beforeAll(async () => {
    await truncateAllTenantTables();
  });

  afterEach(async () => {
    await truncateAllTenantTables();
  });

  afterAll(async () => {
    await db.$client.end({ timeout: 1 });
  });

  it("#47 flags Groceries and applying the suggestion raises savings by the tickets", async () => {
    const userId = await seedUser("google-sub-uc25-47");
    const { monthId, groceries } = await seedMonth(userId);
    await addLine(userId, monthId, groceries, "Groceries", "400.00");
    await addActual(userId, { monthId, categoryId: groceries, name: "Market", amount: "120.00" });

    const check = await getEstimateCheck(userId, monthId);
    expect(check.categories).toHaveLength(1);
    expect(check.categories[0]).toMatchObject({
      plan: 40_000,
      remaining: 40_000,
      tickets: 12_000,
      suggested: 28_000,
      flagged: true,
    });

    const savingsBefore = (await getMonthSummary(userId, monthId)).potentialSavings;
    const after = await applyEstimateSuggestion(userId, {
      monthId,
      categoryId: groceries,
      mode: "suggested",
    });
    expect(after.categories[0]).toMatchObject({ remaining: 28_000, flagged: false });
    const savingsAfter = (await getMonthSummary(userId, monthId)).potentialSavings;
    expect(savingsAfter - savingsBefore).toBe(12_000);
  });

  it("#48 distributes the suggestion in name order", async () => {
    const userId = await seedUser("google-sub-uc25-48");
    const { monthId, groceries } = await seedMonth(userId);
    await addLine(userId, monthId, groceries, "Groceries", "300.00");
    await addLine(userId, monthId, groceries, "Extra", "100.00");
    await addActual(userId, { monthId, categoryId: groceries, name: "Market", amount: "350.00" });

    const after = await applyEstimateSuggestion(userId, {
      monthId,
      categoryId: groceries,
      mode: "suggested",
    });
    expect(after.categories[0]!.lines).toEqual([
      expect.objectContaining({ name: "Extra", remaining: 5_000 }),
      expect.objectContaining({ name: "Groceries", remaining: 0 }),
    ]);
  });

  it("#49 release zeroes estimated lines only; committed lines and templates untouched", async () => {
    const userId = await seedUser("google-sub-uc25-49");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Groceries",
      amount: "400.00",
      kind: "estimated",
    });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Delivery box",
      amount: "50.00",
      kind: "committed",
    });
    const monthRow = await createMonth(userId, { year: 2025, month: 3 });
    await addActual(userId, {
      monthId: monthRow.id,
      categoryId: groceries.id,
      name: "Market",
      amount: "120.00",
    });
    const templatesBefore = await db.execute(sql`SELECT amount::text AS a FROM template ORDER BY 1`);

    await applyEstimateSuggestion(userId, {
      monthId: monthRow.id,
      categoryId: groceries.id,
      mode: "release",
    });

    const lines = await db.execute<{ kind: string; r: string }>(
      sql`SELECT kind, remaining_amount::text AS r FROM month_fixed_line WHERE month_id = ${monthRow.id} ORDER BY kind`,
    );
    expect(lines.map((l) => [l.kind, l.r])).toEqual([
      ["committed", "50.00"],
      ["estimated", "0.00"],
    ]);
    expect(await db.execute(sql`SELECT amount::text AS a FROM template ORDER BY 1`)).toEqual(
      templatesBefore,
    );
  });

  it("#50 adding a ticket never changes any remaining by itself", async () => {
    const userId = await seedUser("google-sub-uc25-50");
    const { monthId, groceries } = await seedMonth(userId);
    await addLine(userId, monthId, groceries, "Groceries", "400.00");
    const snapshot = () =>
      db.execute(sql`SELECT remaining_amount::text AS r FROM month_fixed_line ORDER BY 1`);
    const before = await snapshot();
    await addActual(userId, { monthId, categoryId: groceries, name: "Market", amount: "120.00" });
    expect(await snapshot()).toEqual(before);
  });

  it("tickets created by pass-to-actual are listed but not counted", async () => {
    const userId = await seedUser("google-sub-uc25-passed");
    const { monthId, groceries } = await seedMonth(userId);
    await addLine(userId, monthId, groceries, "Groceries", "400.00");
    const committed = await addMonthOnlyLine(userId, {
      monthId,
      categoryId: groceries,
      name: "Delivery box",
      amount: "50.00",
      kind: "committed",
    });
    await passToActual(userId, { lineId: committed.id });

    const [cat] = (await getEstimateCheck(userId, monthId)).categories;
    expect(cat).toMatchObject({ plan: 40_000, tickets: 0, flagged: false });
    expect(cat!.ticketList).toEqual([
      expect.objectContaining({ name: "Delivery box", amount: 5_000, counted: false }),
    ]);
  });

  it("rejects a category without estimated lines", async () => {
    const userId = await seedUser("google-sub-uc25-nocat");
    const { monthId, groceries } = await seedMonth(userId);
    await expect(
      applyEstimateSuggestion(userId, { monthId, categoryId: groceries, mode: "suggested" }),
    ).rejects.toBeInstanceOf(EstimateCategoryNotFoundError);
  });

  it("#51 tenancy: user B cannot read or apply the check on user A's month", async () => {
    const userA = await seedUser("google-sub-uc25-a");
    const userB = await seedUser("google-sub-uc25-b");
    const { monthId, groceries } = await seedMonth(userA);
    await addLine(userA, monthId, groceries, "Groceries", "400.00");
    await addActual(userA, { monthId, categoryId: groceries, name: "Market", amount: "120.00" });

    await expect(getEstimateCheck(userB, monthId)).rejects.toBeInstanceOf(MonthNotFoundError);
    await expect(
      applyEstimateSuggestion(userB, { monthId, categoryId: groceries, mode: "release" }),
    ).rejects.toBeInstanceOf(MonthNotFoundError);
    expect((await getEstimateCheck(userA, monthId)).categories[0]!.remaining).toBe(40_000);
  });
});

async function seedMonth(userId: string) {
  const salary = await createCategory(userId, { kind: "income", name: "Salary" });
  const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
  const monthRow = await createMonth(userId, { year: 2026, month: 9 });
  await addIncome(userId, {
    monthId: monthRow.id,
    categoryId: salary.id,
    name: "Salary",
    amount: "3000.00",
  });
  return { monthId: monthRow.id, groceries: groceries.id };
}

async function addLine(
  userId: string,
  monthId: string,
  categoryId: string,
  name: string,
  amount: string,
) {
  await addMonthOnlyLine(userId, { monthId, categoryId, name, amount, kind: "estimated" });
}

async function seedUser(googleSub: string): Promise<string> {
  const [{ id }] = await db.execute<{ id: string }>(
    sql`INSERT INTO app_user (google_sub, email) VALUES (${googleSub}, ${`${googleSub}@example.com`}) RETURNING id`,
  );
  return id;
}

async function pingDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch (err) {
    process.stderr.write(
      `[integration] Postgres unreachable, skipping UC-25 suite: ${(err as Error).message}\n`,
    );
    return false;
  }
}

async function truncateAllTenantTables(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE app_user CASCADE`);
}
