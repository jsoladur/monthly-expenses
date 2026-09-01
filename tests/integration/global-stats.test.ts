import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { createCategory } from "@/server/services/categories";
import { createMonth } from "@/server/services/months";
import { addIncome } from "@/server/services/incomes";
import { addActual, deleteActual } from "@/server/services/actuals";
import { addMonthOnlyLine } from "@/server/services/reserved-lines";
import { getGlobalStatsPage } from "@/server/services/global-stats";
import { loadGlobalStatsAggregates } from "@/server/repositories/global-stats";

const reachable = await pingDatabase();
const suite = reachable ? describe : describe.skip;

suite("UC-15 global stats integration", () => {
  beforeAll(async () => {
    await truncateAllTenantTables();
  });

  afterEach(async () => {
    await truncateAllTenantTables();
  });

  afterAll(async () => {
    await db.$client.end({ timeout: 1 });
  });

  it("10 — every aggregate filters month.user_id; User B is isolated", async () => {
    const alice = await seedUser("google-sub-uc15-iso-alice");
    const bob = await seedUser("google-sub-uc15-iso-bob");
    const food = await createCategory(alice, { kind: "expense", name: "Food" });
    const salary = await createCategory(alice, { kind: "income", name: "Salary" });
    const monthRow = await createMonth(alice, { year: 2024, month: 1 });
    await addIncome(alice, {
      monthId: monthRow.id,
      categoryId: salary.id,
      name: "Pay",
      amount: "1000.00",
    });
    await addActual(alice, {
      monthId: monthRow.id,
      categoryId: food.id,
      name: "Groceries",
      amount: "200.00",
    });

    const alicePage = await getGlobalStatsPage(alice, { tab: "overview" });
    const bobPage = await getGlobalStatsPage(bob, { tab: "overview" });
    expect(alicePage.meta.empty).toBe(false);
    expect(alicePage.overview?.incomeCents).toBe(100_000);
    expect(bobPage.meta.empty).toBe(true);
    expect(bobPage.overview).toBeNull();

    const bobAgg = await loadGlobalStatsAggregates(bob);
    expect(bobAgg.presence).toEqual([]);
    expect(bobAgg.incomeByMonth).toEqual([]);
    expect(bobAgg.spendByMonth).toEqual([]);
  });

  it("11 — SQL aggregates match a hand-sum; hard-delete drops the actual", async () => {
    const userId = await seedUser("google-sub-uc15-handsum");
    const food = await createCategory(userId, { kind: "expense", name: "Food" });
    const rent = await createCategory(userId, { kind: "expense", name: "Rent" });
    const salary = await createCategory(userId, { kind: "income", name: "Salary" });

    const m1 = await createMonth(userId, { year: 2024, month: 1 });
    const m2 = await createMonth(userId, { year: 2024, month: 2 });
    const m3 = await createMonth(userId, { year: 2024, month: 3 });

    await addIncome(userId, { monthId: m1.id, categoryId: salary.id, name: "Pay", amount: "100.00" });
    await addIncome(userId, { monthId: m2.id, categoryId: salary.id, name: "Pay", amount: "200.00" });
    await addIncome(userId, { monthId: m3.id, categoryId: salary.id, name: "Pay", amount: "300.00" });

    await addActual(userId, { monthId: m1.id, categoryId: food.id, name: "A", amount: "10.00" });
    await addActual(userId, { monthId: m2.id, categoryId: food.id, name: "B", amount: "20.00" });
    const rentTicket = await addActual(userId, {
      monthId: m3.id,
      categoryId: rent.id,
      name: "C",
      amount: "40.00",
    });

    const before = await getGlobalStatsPage(userId, { tab: "overview" });
    expect(before.overview?.incomeCents).toBe(60_000);
    expect(before.overview?.spendCents).toBe(7_000);

    await deleteActual(userId, { id: rentTicket.id });
    const after = await getGlobalStatsPage(userId, { tab: "overview" });
    expect(after.overview?.spendCents).toBe(3_000);
  });

  it("12 — remaining is excluded from actual-spend and included only on projection", async () => {
    const userId = await seedUser("google-sub-uc15-remaining");
    const food = await createCategory(userId, { kind: "expense", name: "Food" });
    const salary = await createCategory(userId, { kind: "income", name: "Salary" });
    const monthRow = await createMonth(userId, { year: 2026, month: 8 });
    await addIncome(userId, {
      monthId: monthRow.id,
      categoryId: salary.id,
      name: "Pay",
      amount: "500.00",
    });
    await addActual(userId, {
      monthId: monthRow.id,
      categoryId: food.id,
      name: "Milk",
      amount: "50.00",
    });
    await addMonthOnlyLine(userId, {
      monthId: monthRow.id,
      categoryId: food.id,
      name: "Envelope",
      amount: "80.00",
      kind: "estimated",
    });

    const plain = await getGlobalStatsPage(userId, { tab: "overview" });
    expect(plain.overview?.spendCents).toBe(5_000);
    expect(plain.meta.openMonth?.remainingCents).toBe(8_000);

    const projected = await getGlobalStatsPage(userId, { tab: "overview", project: "1" });
    expect(projected.overview?.spendCents).toBe(13_000);
  });
});

async function seedUser(googleSub: string): Promise<string> {
  const [{ id }] = await db.execute<{ id: string }>(
    sql`INSERT INTO app_user (google_sub, email) VALUES (${googleSub}, ${`${googleSub}@example.com`}) RETURNING id`,
  );
  if (!id) throw new Error("seedUser returned no id");
  return id;
}

async function pingDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch (err) {
    process.stderr.write(
      `[integration] Postgres unreachable, skipping UC-15 suite: ${(err as Error).message}\n`,
    );
    return false;
  }
}

async function truncateAllTenantTables(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE app_user CASCADE`);
}
