import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { createCategory } from "@/server/services/categories";
import {
  EndMonthOnEstimatedError,
  InvalidEndMonthError,
  TemplateNotFoundError,
  createTemplate,
  deactivateTemplate,
  listTemplatesForManagement,
  reactivateTemplate,
  updateTemplate,
} from "@/server/services/templates";
import { DuplicateMonthError, createMonth } from "@/server/services/months";
import { addActual } from "@/server/services/actuals";
import { getOverspendWarnings } from "@/server/services/summary";

// ============================================================================
// UC-29 last payment month for committed fixed expenses — integration
// (PRD §15 #66–#73, C29).
//
// Skipped (not failed) when Postgres is unreachable, like the other suites.
// ============================================================================

const reachable = await pingDatabase();

const suite = reachable ? describe : describe.skip;

const MARCH_2027 = { year: 2027, month: 3 };

suite("UC-29 last payment month", () => {
  beforeAll(async () => {
    await truncateAllTenantTables();
  });

  afterEach(async () => {
    await truncateAllTenantTables();
  });

  afterAll(async () => {
    await db.$client.end({ timeout: 1 });
  });

  it("#66 copied up to and including the last payment month, then deactivated", async () => {
    const userId = await seedUser("google-sub-uc29-happy");
    const loan = await seedLoan(userId);
    expect(loan.endYear).toBe(2027);
    expect(loan.endMonth).toBe(3);

    const feb = await createMonth(userId, { year: 2027, month: 2 });
    expect(await lineNames(feb.id)).toEqual(["Car loan"]);
    expect(await templateState(loan.id)).toMatchObject({ active: true });

    const mar = await createMonth(userId, { year: 2027, month: 3 });
    expect(await lineNames(mar.id)).toEqual(["Car loan"]);
    const ended = await templateState(loan.id);
    // Deactivated, NOT deleted: the row and its last payment month stay.
    expect(ended).toMatchObject({ active: false, end_year: 2027, end_month: 3 });
    expect(ended?.deleted_at).not.toBeNull();

    const apr = await createMonth(userId, { year: 2027, month: 4 });
    expect(await lineNames(apr.id)).toEqual([]);
    // Earlier months keep their copies (PRD §7.8).
    expect(await lineNames(feb.id)).toEqual(["Car loan"]);
    expect(await lineNames(mar.id)).toEqual(["Car loan"]);
  });

  it("#67 a month after a skipped last payment month does not copy and deactivates", async () => {
    const userId = await seedUser("google-sub-uc29-skipped");
    const loan = await seedLoan(userId);

    const may = await createMonth(userId, { year: 2027, month: 5 });

    expect(await lineNames(may.id)).toEqual([]);
    expect(await templateState(loan.id)).toMatchObject({ active: false });
  });

  it("#68 creating a month before the last payment month never deactivates", async () => {
    const userId = await seedUser("google-sub-uc29-backfill");
    const loan = await seedLoan(userId);

    const jan = await createMonth(userId, { year: 2027, month: 1 });
    const dec = await createMonth(userId, { year: 2026, month: 12 });

    expect(await lineNames(jan.id)).toEqual(["Car loan"]);
    expect(await lineNames(dec.id)).toEqual(["Car loan"]);
    expect(await templateState(loan.id)).toMatchObject({ active: true });
  });

  it("#69 estimated fixed expenses and out-of-range months are rejected", async () => {
    const userId = await seedUser("google-sub-uc29-validation");
    const cat = await createCategory(userId, { kind: "expense", name: "Loans" });

    await expect(
      createTemplate(userId, {
        categoryId: cat.id,
        name: "Groceries",
        amount: "400.00",
        kind: "estimated",
        endMonth: MARCH_2027,
      }),
    ).rejects.toBeInstanceOf(EndMonthOnEstimatedError);
    await expect(
      createTemplate(userId, {
        categoryId: cat.id,
        name: "Bad month",
        amount: "1.00",
        kind: "committed",
        endMonth: { year: 2027, month: 13 },
      }),
    ).rejects.toBeInstanceOf(InvalidEndMonthError);
    await expect(
      createTemplate(userId, {
        categoryId: cat.id,
        name: "Bad year",
        amount: "1.00",
        kind: "committed",
        endMonth: { year: 1969, month: 1 },
      }),
    ).rejects.toBeInstanceOf(InvalidEndMonthError);
    expect(await listTemplatesForManagement(userId, undefined)).toHaveLength(0);
  });

  it("#69 the DB check rejects half-set values and an estimated row written directly", async () => {
    const userId = await seedUser("google-sub-uc29-check");
    const cat = await createCategory(userId, { kind: "expense", name: "Loans" });
    const committed = await createTemplate(userId, {
      categoryId: cat.id,
      name: "Car loan",
      amount: "250.00",
      kind: "committed",
    });
    const estimated = await createTemplate(userId, {
      categoryId: cat.id,
      name: "Groceries",
      amount: "400.00",
      kind: "estimated",
    });

    await expect(
      db.execute(sql`UPDATE template SET end_year = 2027 WHERE id = ${committed.id}`),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`UPDATE template SET end_month = 3 WHERE id = ${committed.id}`),
    ).rejects.toThrow();
    await expect(
      db.execute(
        sql`UPDATE template SET end_year = 2027, end_month = 13 WHERE id = ${committed.id}`,
      ),
    ).rejects.toThrow();
    await expect(
      db.execute(
        sql`UPDATE template SET end_year = 2027, end_month = 3 WHERE id = ${estimated.id}`,
      ),
    ).rejects.toThrow();
  });

  it("an edit can set, change and remove the last payment month without deactivating", async () => {
    const userId = await seedUser("google-sub-uc29-edit");
    const cat = await createCategory(userId, { kind: "expense", name: "Loans" });
    const loan = await createTemplate(userId, {
      categoryId: cat.id,
      name: "Car loan",
      amount: "250.00",
      kind: "committed",
    });
    expect(loan.endYear).toBeNull();
    expect(loan.endMonth).toBeNull();
    const june = await createMonth(userId, { year: 2027, month: 6 });

    const base = {
      id: loan.id,
      categoryId: cat.id,
      name: "Car loan",
      amount: "250.00",
      kind: "committed" as const,
    };
    // A last payment month in the past of an existing month: saved as-is,
    // nothing is deactivated until the next month is created.
    const withEnd = await updateTemplate(userId, { ...base, endMonth: MARCH_2027 });
    expect(withEnd).toMatchObject({ endYear: 2027, endMonth: 3, active: true });
    expect(await lineNames(june.id)).toEqual(["Car loan"]);

    const cleared = await updateTemplate(userId, { ...base, endMonth: null });
    expect(cleared).toMatchObject({ endYear: null, endMonth: null, active: true });
  });

  it("#70 reactivating clears the last payment month; the next month copies it again", async () => {
    const userId = await seedUser("google-sub-uc29-reactivate");
    const loan = await seedLoan(userId);
    await createMonth(userId, { year: 2027, month: 3 });
    expect(await templateState(loan.id)).toMatchObject({ active: false });

    const reactivated = await reactivateTemplate(userId, { id: loan.id });
    expect(reactivated).toMatchObject({ active: true, endYear: null, endMonth: null });

    const apr = await createMonth(userId, { year: 2027, month: 4 });
    expect(await lineNames(apr.id)).toEqual(["Car loan"]);
    expect(await templateState(loan.id)).toMatchObject({ active: true });
  });

  it("#71 the overspend plan counts an ended loan up to its last payment month", async () => {
    const userId = await seedUser("google-sub-uc29-overspend");
    const loan = await seedLoan(userId);
    const mar = await createMonth(userId, { year: 2027, month: 3 });
    const apr = await createMonth(userId, { year: 2027, month: 4 });
    expect(await templateState(loan.id)).toMatchObject({ active: false });

    await addActual(userId, {
      monthId: mar.id,
      categoryId: loan.categoryId,
      name: "Car loan",
      amount: "250.00",
    });
    await addActual(userId, {
      monthId: mar.id,
      categoryId: loan.categoryId,
      name: "Late fee",
      amount: "10.00",
    });
    await addActual(userId, {
      monthId: apr.id,
      categoryId: loan.categoryId,
      name: "Stray charge",
      amount: "5.00",
    });

    // March: plan still 250 (ended loan counts) → overrun is only the fee.
    const marWarnings = await getOverspendWarnings(userId, mar.id);
    expect(marWarnings).toHaveLength(1);
    expect(marWarnings[0]?.estimatedTemplateTotal).toBe(25000);
    expect(marWarnings[0]?.overrunCents).toBe(1000);
    // April: the loan is no longer part of the plan → no template, no warning.
    expect(await getOverspendWarnings(userId, apr.id)).toEqual([]);
  });

  it("#71 a manually deactivated fixed expense without a last payment month stays out of the plan", async () => {
    const userId = await seedUser("google-sub-uc29-overspend-plain");
    const cat = await createCategory(userId, { kind: "expense", name: "Sport" });
    const gym = await createTemplate(userId, {
      categoryId: cat.id,
      name: "Gym",
      amount: "40.00",
      kind: "committed",
    });
    const mar = await createMonth(userId, { year: 2027, month: 3 });
    await deactivateTemplate(userId, { id: gym.id });
    await addActual(userId, {
      monthId: mar.id,
      categoryId: cat.id,
      name: "Gym",
      amount: "60.00",
    });
    expect(await getOverspendWarnings(userId, mar.id)).toEqual([]);
  });

  it("#72 tenancy: B cannot set it on A's fixed expense, and B's months never deactivate A's", async () => {
    const alice = await seedUser("google-sub-uc29-alice");
    const bob = await seedUser("google-sub-uc29-bob");
    const aliceLoan = await seedLoan(alice);
    const bobCat = await createCategory(bob, { kind: "expense", name: "Loans" });

    await expect(
      updateTemplate(bob, {
        id: aliceLoan.id,
        categoryId: bobCat.id,
        name: "Car loan",
        amount: "250.00",
        kind: "committed",
        endMonth: { year: 2026, month: 1 },
      }),
    ).rejects.toBeInstanceOf(TemplateNotFoundError);

    const bobMay = await createMonth(bob, { year: 2027, month: 5 });
    expect(await lineNames(bobMay.id)).toEqual([]);
    expect(await templateState(aliceLoan.id)).toMatchObject({
      active: true,
      end_year: 2027,
      end_month: 3,
    });
  });

  it("#73 a schedule that skips the last payment month copies nothing but still deactivates", async () => {
    const userId = await seedUser("google-sub-uc29-schedule");
    const cat = await createCategory(userId, { kind: "expense", name: "Insurance" });
    const instalment = await createTemplate(userId, {
      categoryId: cat.id,
      name: "Insurance instalment",
      amount: "90.00",
      kind: "committed",
      months: [1, 7],
      endMonth: MARCH_2027,
    });

    const jan = await createMonth(userId, { year: 2027, month: 1 });
    expect(await lineNames(jan.id)).toEqual(["Insurance instalment"]);
    expect(await templateState(instalment.id)).toMatchObject({ active: true });

    const mar = await createMonth(userId, { year: 2027, month: 3 });
    expect(await lineNames(mar.id)).toEqual([]);
    expect(await templateState(instalment.id)).toMatchObject({ active: false });
    expect(await lineNames(jan.id)).toEqual(["Insurance instalment"]);
  });

  it("a duplicate month rolls back: nothing is deactivated", async () => {
    const userId = await seedUser("google-sub-uc29-duplicate");
    const cat = await createCategory(userId, { kind: "expense", name: "Loans" });
    await createMonth(userId, { year: 2027, month: 3 });
    const loan = await createTemplate(userId, {
      categoryId: cat.id,
      name: "Car loan",
      amount: "250.00",
      kind: "committed",
      endMonth: MARCH_2027,
    });

    await expect(createMonth(userId, { year: 2027, month: 3 })).rejects.toBeInstanceOf(
      DuplicateMonthError,
    );
    expect(await templateState(loan.id)).toMatchObject({ active: true });
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

async function seedLoan(userId: string) {
  const cat = await createCategory(userId, { kind: "expense", name: "Loans" });
  return createTemplate(userId, {
    categoryId: cat.id,
    name: "Car loan",
    amount: "250.00",
    kind: "committed",
    endMonth: MARCH_2027,
  });
}

async function templateState(id: string) {
  const [row] = await db.execute<{
    active: boolean;
    end_year: number | null;
    end_month: number | null;
    deleted_at: string | null;
  }>(sql`SELECT active, end_year, end_month, deleted_at FROM template WHERE id = ${id}`);
  return row;
}

async function lineNames(monthId: string): Promise<string[]> {
  const rows = await db.execute<{ name: string }>(
    sql`SELECT name FROM month_fixed_line WHERE month_id = ${monthId} ORDER BY name`,
  );
  return rows.map((r) => r.name);
}

async function pingDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch (err) {
    process.stderr.write(
      `[integration] Postgres unreachable, skipping UC-29 suite: ${(err as Error).message}\n`,
    );
    return false;
  }
}

async function truncateAllTenantTables(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE app_user CASCADE`);
}
