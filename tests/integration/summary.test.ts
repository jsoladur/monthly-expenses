import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { createCategory } from "@/server/services/categories";
import { createTemplate } from "@/server/services/templates";
import { createMonth } from "@/server/services/months";
import { addIncome } from "@/server/services/incomes";
import { addActual } from "@/server/services/actuals";
import { addMonthOnlyLine, updateRemainingAmount } from "@/server/services/reserved-lines";
import { passToActual } from "@/server/services/pass-to-actual";
import {
  getMonthSummary,
  getOverspendWarnings,
  isPastMonth,
  type OverspendWarning,
} from "@/server/services/summary";

// ============================================================================
// UC-11 summary, savings & warnings — integration (PRD §7.1 / §7.4 / §7.7,
// ARCH §8).
//
// Hits the real Postgres the migration suite created. Skipped (not failed)
// when the database is unreachable so `pnpm test` stays usable without
// Docker.
//
// Acceptance (PRD §15 #5, #6, #7, #8, #13, #14, #19):
//   - #5  Mortgage 800 committed + groceries 400 estimated + income 2000
//        → savings 800 on day one. (potential_savings = incomes − (actuals +
//        sum(remaining_amount of fixed/estimated lines)))
//   - #6  Add a grocery ticket 50 with remaining untouched → savings 750
//        (PRD §7.3: tickets do NOT auto-reduce the envelope, so both hit
//        savings — by design).
//   - #7  Decrease groceries remaining to 350 → savings 800. (manual
//        reduction of the reserve lifts savings.)
//   - #8  Pass mortgage to actual → savings STILL 800; the money lives in
//        exactly one place (PRD §7.2).
//   - #13 Past-month banner shown, edits still persist.
//   - #14 Actual of −20 raises savings by 20.
//   - #19 Food templates 400 + 50, actuals 500 → warning; month remaining
//        is IGNORED for the overspend baseline (PRD §7.4).
//
// Tenancy: every read joins on `month.user_id` (PRD §5.1).
// Money: integer cents — never float (ADR-5, ARCH §8).
// Negative amounts allowed everywhere (PRD §7.6).
// ============================================================================

const reachable = await pingDatabase();

const suite = reachable ? describe : describe.skip;

suite("UC-11 summary, savings & warnings", () => {
  beforeAll(async () => {
    await truncateAllTenantTables();
  });

  afterEach(async () => {
    await truncateAllTenantTables();
  });

  afterAll(async () => {
    await db.$client.end({ timeout: 1 });
  });

  // --------------------------------------------------------------------------
  // getMonthSummary — PRD §7.1
  // --------------------------------------------------------------------------

  it("#5 — fresh month with mortgage 800 + groceries 400 + income 2000 → savings 800.00", async () => {
    const userId = await seedUser("google-sub-uc11-#5");
    const mortgage = await createCategory(userId, { kind: "expense", name: "Mortgage" });
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    const salary = await createCategory(userId, { kind: "income", name: "Salary" });
    await createTemplate(userId, {
      categoryId: mortgage.id,
      name: "Mortgage",
      amount: "800.00",
      kind: "committed",
    });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Groceries",
      amount: "400.00",
      kind: "estimated",
    });
    const month = await createMonth(userId, { year: 2026, month: 8 });
    await addIncome(userId, {
      monthId: month.id,
      categoryId: salary.id,
      name: "Monthly salary",
      amount: "2000.00",
    });

    const summary = await getMonthSummary(userId, month.id);
    expect(summary.incomesTotal).toBe(200000);
    expect(summary.actualsTotal).toBe(0);
    expect(summary.reservedRemainingTotal).toBe(120000); // 800 + 400
    expect(summary.potentialSavings).toBe(80000); // 2000 − (0 + 1200) = 800
  });

  it("#6 — add grocery ticket 50, remaining untouched → savings 750.00 (PRD §7.3, double-count by design)", async () => {
    const userId = await seedUser("google-sub-uc11-#6");
    const mortgage = await createCategory(userId, { kind: "expense", name: "Mortgage" });
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    const salary = await createCategory(userId, { kind: "income", name: "Salary" });
    await createTemplate(userId, {
      categoryId: mortgage.id,
      name: "Mortgage",
      amount: "800.00",
      kind: "committed",
    });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Groceries",
      amount: "400.00",
      kind: "estimated",
    });
    const month = await createMonth(userId, { year: 2026, month: 8 });
    await addIncome(userId, {
      monthId: month.id,
      categoryId: salary.id,
      name: "Monthly salary",
      amount: "2000.00",
    });
    await addActual(userId, {
      monthId: month.id,
      categoryId: groceries.id,
      name: "Bread",
      amount: "50.00",
    });

    const summary = await getMonthSummary(userId, month.id);
    expect(summary.incomesTotal).toBe(200000);
    expect(summary.actualsTotal).toBe(5000);
    expect(summary.reservedRemainingTotal).toBe(120000);
    expect(summary.potentialSavings).toBe(75000); // 2000 − (50 + 1200) = 750
  });

  it("#7 — decrease groceries remaining 400 → 350 (with UC-09) → savings back to 800.00", async () => {
    const userId = await seedUser("google-sub-uc11-#7");
    const mortgage = await createCategory(userId, { kind: "expense", name: "Mortgage" });
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    const salary = await createCategory(userId, { kind: "income", name: "Salary" });
    await createTemplate(userId, {
      categoryId: mortgage.id,
      name: "Mortgage",
      amount: "800.00",
      kind: "committed",
    });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Groceries",
      amount: "400.00",
      kind: "estimated",
    });
    const month = await createMonth(userId, { year: 2026, month: 8 });
    await addIncome(userId, {
      monthId: month.id,
      categoryId: salary.id,
      name: "Monthly salary",
      amount: "2000.00",
    });
    // PRD #7 is the continuation of #6: user added a 50 ticket, savings
    // dropped to 750; user manually reduces the groceries envelope from
    // 400 to 350 to compensate, savings returns to 800.
    await addActual(userId, {
      monthId: month.id,
      categoryId: groceries.id,
      name: "Bread",
      amount: "50.00",
    });
    const workspace = await getMonthWorkspace(userId, 2026, 8);
    const groceryLine = workspace.lines.find(
      (l) => l.kind === "estimated" && l.name === "Groceries",
    )!;
    await updateRemainingAmount(userId, {
      lineId: groceryLine.id,
      remainingAmount: "350.00",
    });

    const summary = await getMonthSummary(userId, month.id);
    // reserved = 800 + 350 = 1150 ; actuals = 50 ; savings = 2000 − (50+1150) = 800
    expect(summary.reservedRemainingTotal).toBe(115000);
    expect(summary.actualsTotal).toBe(5000);
    expect(summary.potentialSavings).toBe(80000);
  });

  it("#8 — pass mortgage to actual → savings STILL 800.00; money only in actuals (PRD §7.2, §7.5)", async () => {
    const userId = await seedUser("google-sub-uc11-#8");
    const mortgage = await createCategory(userId, { kind: "expense", name: "Mortgage" });
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    const salary = await createCategory(userId, { kind: "income", name: "Salary" });
    await createTemplate(userId, {
      categoryId: mortgage.id,
      name: "Mortgage",
      amount: "800.00",
      kind: "committed",
    });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Groceries",
      amount: "400.00",
      kind: "estimated",
    });
    const month = await createMonth(userId, { year: 2026, month: 8 });
    await addIncome(userId, {
      monthId: month.id,
      categoryId: salary.id,
      name: "Monthly salary",
      amount: "2000.00",
    });
    const before = (await getMonthWorkspace(userId, 2026, 8)).lines.find(
      (l) => l.name === "Mortgage",
    )!;
    await passToActual(userId, { lineId: before.id });

    const summary = await getMonthSummary(userId, month.id);
    // Savings unchanged at 800 because the mortgage moved from reserved to
    // actuals in the same month (PRD §7.2: no double-count).
    expect(summary.actualsTotal).toBe(80000);
    expect(summary.reservedRemainingTotal).toBe(40000); // only groceries left
    expect(summary.potentialSavings).toBe(80000);
  });

  it("#14 — an actual with negative amount RAISES savings by that amount (PRD §7.6)", async () => {
    const userId = await seedUser("google-sub-uc11-#14");
    const mortgage = await createCategory(userId, { kind: "expense", name: "Mortgage" });
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    const salary = await createCategory(userId, { kind: "income", name: "Salary" });
    await createTemplate(userId, {
      categoryId: mortgage.id,
      name: "Mortgage",
      amount: "800.00",
      kind: "committed",
    });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Groceries",
      amount: "400.00",
      kind: "estimated",
    });
    const month = await createMonth(userId, { year: 2026, month: 8 });
    await addIncome(userId, {
      monthId: month.id,
      categoryId: salary.id,
      name: "Monthly salary",
      amount: "2000.00",
    });
    // Refund ticket of -20 (PRD UC-16).
    await addActual(userId, {
      monthId: month.id,
      categoryId: groceries.id,
      name: "Refund",
      amount: "-20.00",
    });

    const summary = await getMonthSummary(userId, month.id);
    // baseline 800.00 → with -20.00 actual savings becomes 820.00
    expect(summary.actualsTotal).toBe(-2000);
    expect(summary.potentialSavings).toBe(82000);
  });

  it("an empty month with no incomes / actuals / lines reports 0 across the board", async () => {
    const userId = await seedUser("google-sub-uc11-empty");
    const month = await createMonth(userId, { year: 2026, month: 8 });

    const summary = await getMonthSummary(userId, month.id);
    expect(summary.incomesTotal).toBe(0);
    expect(summary.actualsTotal).toBe(0);
    expect(summary.reservedRemainingTotal).toBe(0);
    expect(summary.potentialSavings).toBe(0);
  });

  it("tenancy: summary never reads another tenant's rows (PRD §5.1, UC-17)", async () => {
    const alice = await seedUser("google-sub-uc11-iso-alice");
    const bob = await seedUser("google-sub-uc11-iso-bob");
    const mortgage = await createCategory(alice, { kind: "expense", name: "Mortgage" });
    const salary = await createCategory(alice, { kind: "income", name: "Salary" });
    await createTemplate(alice, {
      categoryId: mortgage.id,
      name: "Mortgage",
      amount: "800.00",
      kind: "committed",
    });
    const aliceMonth = await createMonth(alice, { year: 2026, month: 8 });
    await addIncome(alice, {
      monthId: aliceMonth.id,
      categoryId: salary.id,
      name: "Monthly salary",
      amount: "2000.00",
    });

    // Bob has no months. He pokes at Alice's monthId — service must look up
    // the month for the given tenant and 404 if it isn't his.
    await expect(getMonthSummary(bob, aliceMonth.id)).rejects.toThrow(
      /Month not found/,
    );
  });

  it("hard-deleted actuals and lines are excluded from sums (PRD C15 / §13)", async () => {
    const userId = await seedUser("google-sub-uc11-hard-delete");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    const salary = await createCategory(userId, { kind: "income", name: "Salary" });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Groceries",
      amount: "400.00",
      kind: "estimated",
    });
    const month = await createMonth(userId, { year: 2026, month: 8 });
    await addIncome(userId, {
      monthId: month.id,
      categoryId: salary.id,
      name: "Monthly salary",
      amount: "2000.00",
    });

    const { deleteActual } = await import("@/server/services/actuals");
    const { deleteMonthLine } = await import("@/server/services/reserved-lines");
    const workspace = await getMonthWorkspace(userId, 2026, 8);
    const groceryLine = workspace.lines[0]!;

    await addActual(userId, {
      monthId: month.id,
      categoryId: groceries.id,
      name: "Bread",
      amount: "50.00",
    });
    const ws2 = await getMonthWorkspace(userId, 2026, 8);
    const actual = ws2.actuals[0]!;

    // Remove both rows — sums should collapse to 0 reserved + 0 actual.
    await deleteActual(userId, { id: actual.id });
    await deleteMonthLine(userId, { lineId: groceryLine.id });

    const summary = await getMonthSummary(userId, month.id);
    expect(summary.actualsTotal).toBe(0);
    expect(summary.reservedRemainingTotal).toBe(0);
    expect(summary.potentialSavings).toBe(200000);
  });

  it("month-only reserved lines participate in savings (PRD §7.1)", async () => {
    const userId = await seedUser("google-sub-uc11-month-only-line");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    const salary = await createCategory(userId, { kind: "income", name: "Salary" });
    const month = await createMonth(userId, { year: 2026, month: 8 });
    await addIncome(userId, {
      monthId: month.id,
      categoryId: salary.id,
      name: "Salary",
      amount: "2000.00",
    });
    await addMonthOnlyLine(userId, {
      monthId: month.id,
      categoryId: groceries.id,
      name: "One-off gift",
      amount: "100.00",
      kind: "estimated",
    });

    const summary = await getMonthSummary(userId, month.id);
    expect(summary.reservedRemainingTotal).toBe(10000);
    expect(summary.potentialSavings).toBe(190000);
  });

  // --------------------------------------------------------------------------
  // isPastMonth — PRD §7.7 / C8
  // --------------------------------------------------------------------------

  it("#13 — isPastMonth returns true when the open month is not the current calendar month", () => {
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth() + 1;

    // Anything before "current month" is past. Edge: if current month is 1
    // (January), use December of previous year as a guaranteed-past anchor.
    const pastYear = currentMonth === 1 ? currentYear - 1 : currentYear;
    const pastMonth = currentMonth === 1 ? 12 : currentMonth - 1;

    expect(isPastMonth(pastYear, pastMonth, now)).toBe(true);
  });

  it("#13 — isPastMonth returns false when the open month IS the current calendar month", () => {
    const now = new Date();
    expect(isPastMonth(now.getUTCFullYear(), now.getUTCMonth() + 1, now)).toBe(
      false,
    );
  });

  it("isPastMonth for future months returns true (only the open = current is allowed)", () => {
    const now = new Date();
    const futureYear = now.getUTCFullYear() + 1;
    expect(isPastMonth(futureYear, 1, now)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // getOverspendWarnings — PRD §7.4 / C18 / #19
  // --------------------------------------------------------------------------

  it("#19 — Food templates 400 + 50, actuals 500 → warning; month remaining is IGNORED", async () => {
    const userId = await seedUser("google-sub-uc11-#19");
    const food = await createCategory(userId, { kind: "expense", name: "Food" });
    await createTemplate(userId, {
      categoryId: food.id,
      name: "Groceries",
      amount: "400.00",
      kind: "estimated",
    });
    await createTemplate(userId, {
      categoryId: food.id,
      name: "Extra",
      amount: "50.00",
      kind: "estimated",
    });
    const month = await createMonth(userId, { year: 2026, month: 8 });

    // Drop the cloned Groceries remaining to 50 (way under the plan) and
    // add 500 in actual tickets.
    const ws = await getMonthWorkspace(userId, 2026, 8);
    const groceries = ws.lines.find((l) => l.name === "Groceries")!;
    await updateRemainingAmount(userId, {
      lineId: groceries.id,
      remainingAmount: "50.00",
    });
    await addActual(userId, {
      monthId: month.id,
      categoryId: food.id,
      name: "Bread",
      amount: "500.00",
    });

    const warnings = await getOverspendWarnings(userId, month.id);
    expect(warnings).toHaveLength(1);
    const warning: OverspendWarning = warnings[0]!;
    expect(warning.categoryId).toBe(food.id);
    // Right side = 400 + 50 = 450 (active templates).
    expect(warning.estimatedTemplateTotal).toBe(45000);
    // Left side = 500.
    expect(warning.actualsTotal).toBe(50000);
    expect(warning.overrunCents).toBe(5000);
  });

  it("no warning when actuals ≤ active template sum (PRD §7.4)", async () => {
    const userId = await seedUser("google-sub-uc11-no-warning");
    const food = await createCategory(userId, { kind: "expense", name: "Food" });
    await createTemplate(userId, {
      categoryId: food.id,
      name: "Groceries",
      amount: "400.00",
      kind: "estimated",
    });
    const month = await createMonth(userId, { year: 2026, month: 8 });
    await addActual(userId, {
      monthId: month.id,
      categoryId: food.id,
      name: "Bread",
      amount: "400.00",
    });

    const warnings = await getOverspendWarnings(userId, month.id);
    expect(warnings).toEqual([]);
  });

  it("a category with ONLY COMMITTED templates warns when actuals exceed that plan (PRD §7.4)", async () => {
    const userId = await seedUser("google-sub-uc11-committed-only");
    const mortgage = await createCategory(userId, { kind: "expense", name: "Mortgage" });
    await createTemplate(userId, {
      categoryId: mortgage.id,
      name: "Mortgage",
      amount: "800.00",
      kind: "committed",
    });
    const month = await createMonth(userId, { year: 2026, month: 8 });
    await addActual(userId, {
      monthId: month.id,
      categoryId: mortgage.id,
      name: "Mortgage ticket",
      amount: "1500.00",
    });

    const warnings = await getOverspendWarnings(userId, month.id);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.estimatedTemplateTotal).toBe(80_000);
    expect(warnings[0]!.overrunCents).toBe(70_000);
  });

  it("inactive templates are excluded from the baseline (PRD §6.3 / §7.4)", async () => {
    const userId = await seedUser("google-sub-uc11-inactive-excluded");
    const food = await createCategory(userId, { kind: "expense", name: "Food" });
    const groceries = await createTemplate(userId, {
      categoryId: food.id,
      name: "Groceries",
      amount: "400.00",
      kind: "estimated",
    });
    const extra = await createTemplate(userId, {
      categoryId: food.id,
      name: "Extra",
      amount: "50.00",
      kind: "estimated",
    });
    const month = await createMonth(userId, { year: 2026, month: 8 });
    await addActual(userId, {
      monthId: month.id,
      categoryId: food.id,
      name: "Bread",
      amount: "410.00",
    });

    // Baseline = 400 + 50 = 450. Over by -40 → no warning.
    let warnings = await getOverspendWarnings(userId, month.id);
    expect(warnings).toEqual([]);

    // Deactivate one template → baseline drops to 400. Actuals 410 → over.
    const { deactivateTemplate } = await import("@/server/services/templates");
    await deactivateTemplate(userId, { id: extra.id });

    warnings = await getOverspendWarnings(userId, month.id);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.estimatedTemplateTotal).toBe(40000);
    expect(warnings[0]!.overrunCents).toBe(1000);
    // The inactive template is the only one left — sanity check on its
    // expected `amount` so we know the test isn't accidentally using the
    // active template (which would also be 400).
    expect(groceries.amount).toBe("400.00");
  });

  it("overspend baseline is the sum of ACTIVE templates (committed + estimated)", async () => {
    const userId = await seedUser("google-sub-uc11-mixed-kinds");
    const mixed = await createCategory(userId, { kind: "expense", name: "Mixed" });
    await createTemplate(userId, {
      categoryId: mixed.id,
      name: "CommittedOnly",
      amount: "100.00",
      kind: "committed",
    });
    await createTemplate(userId, {
      categoryId: mixed.id,
      name: "Envelope",
      amount: "50.00",
      kind: "estimated",
    });
    const month = await createMonth(userId, { year: 2026, month: 8 });
    await addActual(userId, {
      monthId: month.id,
      categoryId: mixed.id,
      name: "Big ticket",
      amount: "200.00",
    });

    const warnings = await getOverspendWarnings(userId, month.id);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.estimatedTemplateTotal).toBe(15_000);
    expect(warnings[0]!.overrunCents).toBe(5_000);
  });

  it("overspend: negative actuals reduce the LEFT side (PRD §7.6)", async () => {
    const userId = await seedUser("google-sub-uc11-negative-actuals");
    const food = await createCategory(userId, { kind: "expense", name: "Food" });
    await createTemplate(userId, {
      categoryId: food.id,
      name: "Groceries",
      amount: "400.00",
      kind: "estimated",
    });
    const month = await createMonth(userId, { year: 2026, month: 8 });
    await addActual(userId, {
      monthId: month.id,
      categoryId: food.id,
      name: "Refund",
      amount: "-50.00",
    });
    await addActual(userId, {
      monthId: month.id,
      categoryId: food.id,
      name: "Bread",
      amount: "300.00",
    });

    const warnings = await getOverspendWarnings(userId, month.id);
    expect(warnings).toEqual([]); // -50 + 300 = 250 ≤ 400
  });

  it("tenancy: warnings never see another tenant's data (PRD §5.1, UC-17)", async () => {
    const alice = await seedUser("google-sub-uc11-warn-iso-alice");
    const bob = await seedUser("google-sub-uc11-warn-iso-bob");
    const food = await createCategory(alice, { kind: "expense", name: "Food" });
    await createTemplate(alice, {
      categoryId: food.id,
      name: "Groceries",
      amount: "400.00",
      kind: "estimated",
    });
    const aliceMonth = await createMonth(alice, { year: 2026, month: 8 });
    await addActual(alice, {
      monthId: aliceMonth.id,
      categoryId: food.id,
      name: "Bread",
      amount: "500.00",
    });

    // Bob has no month. Service looks up the month for the given tenant and
    // 404s if it isn't his.
    await expect(getOverspendWarnings(bob, aliceMonth.id)).rejects.toThrow(
      /Month not found/,
    );
  });
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function getMonthWorkspace(userId: string, year: number, month: number) {
  const { getMonthWorkspace: service } = await import("@/server/services/months");
  return service(userId, year, month);
}

async function seedUser(googleSub: string): Promise<string> {
  const [{ id }] = await db.execute<{ id: string }>(
    sql`INSERT INTO app_user (google_sub, email) VALUES (${googleSub}, ${`${googleSub}@example.com`}) RETURNING id`,
  );
  if (!id) {
    throw new Error("seedUser returned no id");
  }
  return id;
}

async function pingDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch (err) {
    process.stderr.write(
      `[integration] Postgres unreachable, skipping UC-11 suite: ${(err as Error).message}\n`,
    );
    return false;
  }
}

async function truncateAllTenantTables(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE app_user CASCADE`);
}