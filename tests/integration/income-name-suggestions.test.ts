import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { createCategory } from "@/server/services/categories";
import { createMonth } from "@/server/services/months";
import { addActual, listRecentActualNameSuggestions } from "@/server/services/actuals";
import {
  addIncome,
  deleteIncome,
  listRecentIncomeNameSuggestions,
} from "@/server/services/incomes";
import { addMonthOnlyLine } from "@/server/services/reserved-lines";

const reachable = await pingDatabase();
const suite = reachable ? describe : describe.skip;

suite("UC-30 income name suggestions", () => {
  beforeAll(async () => {
    await truncateAllTenantTables();
  });

  afterEach(async () => {
    await truncateAllTenantTables();
  });

  afterAll(async () => {
    await db.$client.end({ timeout: 1 });
  });

  it("never returns another tenant's income names (PRD §15 #75)", async () => {
    const alice = await seedUser("google-sub-uc30-iso-alice");
    const bob = await seedUser("google-sub-uc30-iso-bob");
    const aliceCat = await createCategory(alice, { kind: "income", name: "Salary" });
    const aliceMonth = await createMonth(alice, { year: 2026, month: 8 });
    await addIncome(alice, {
      monthId: aliceMonth.id,
      categoryId: aliceCat.id,
      name: "Nómina Acme",
      amount: "2000.00",
    });
    const bobCat = await createCategory(bob, { kind: "income", name: "Salary" });
    const bobMonth = await createMonth(bob, { year: 2026, month: 8 });
    await addIncome(bob, {
      monthId: bobMonth.id,
      categoryId: bobCat.id,
      name: "Pension",
      amount: "900.00",
    });

    const bobNames = await listRecentIncomeNameSuggestions(bob, 2026, 8);
    expect(bobNames.map((n) => n.name)).toEqual(["Pension"]);
  });

  it("includes June in an August window and excludes May (PRD §15 #74)", async () => {
    const userId = await seedUser("google-sub-uc30-window");
    const cat = await createCategory(userId, { kind: "income", name: "Salary" });
    const august = await createMonth(userId, { year: 2026, month: 8 });
    const june = await createMonth(userId, { year: 2026, month: 6 });
    const may = await createMonth(userId, { year: 2026, month: 5 });
    await addIncome(userId, { monthId: june.id, categoryId: cat.id, name: "Nómina", amount: "2000.00" });
    await addIncome(userId, { monthId: may.id, categoryId: cat.id, name: "Paga extra", amount: "1000.00" });
    await addIncome(userId, { monthId: august.id, categoryId: cat.id, name: "Rent received", amount: "500.00" });

    const names = await listRecentIncomeNameSuggestions(userId, 2026, 8);
    expect(names.map((n) => n.name)).toEqual(["Rent received", "Nómina"]);
  });

  it("collapses duplicate folded names to the newest spelling", async () => {
    const userId = await seedUser("google-sub-uc30-dedupe");
    const cat = await createCategory(userId, { kind: "income", name: "Salary" });
    const july = await createMonth(userId, { year: 2026, month: 7 });
    const august = await createMonth(userId, { year: 2026, month: 8 });
    await addIncome(userId, { monthId: july.id, categoryId: cat.id, name: "Nómina", amount: "2000.00" });
    await addIncome(userId, { monthId: august.id, categoryId: cat.id, name: "nomina", amount: "2000.00" });

    const names = await listRecentIncomeNameSuggestions(userId, 2026, 8);
    expect(names).toHaveLength(1);
    expect(names[0]!.name).toBe("nomina");
    expect(names[0]!.month).toBe(8);
  });

  it("keeps income and actual corpora separate (PRD §15 #74)", async () => {
    const userId = await seedUser("google-sub-uc30-kinds");
    const expense = await createCategory(userId, { kind: "expense", name: "Food" });
    const income = await createCategory(userId, { kind: "income", name: "Salary" });
    const august = await createMonth(userId, { year: 2026, month: 8 });
    await addIncome(userId, { monthId: august.id, categoryId: income.id, name: "Payroll", amount: "2000.00" });
    await addActual(userId, { monthId: august.id, categoryId: expense.id, name: "Bread", amount: "2.00" });
    await addMonthOnlyLine(userId, {
      monthId: august.id,
      categoryId: expense.id,
      name: "Envelope",
      amount: "50.00",
      kind: "estimated",
    });

    const incomeNames = await listRecentIncomeNameSuggestions(userId, 2026, 8);
    expect(incomeNames.map((n) => n.name)).toEqual(["Payroll"]);
    const actualNames = await listRecentActualNameSuggestions(userId, 2026, 8);
    expect(actualNames.map((n) => n.name)).toEqual(["Bread"]);
  });

  it("drops a hard-deleted income from the corpus (PRD C15)", async () => {
    const userId = await seedUser("google-sub-uc30-delete");
    const cat = await createCategory(userId, { kind: "income", name: "Salary" });
    const august = await createMonth(userId, { year: 2026, month: 8 });
    const row = await addIncome(userId, {
      monthId: august.id,
      categoryId: cat.id,
      name: "Payroll",
      amount: "2000.00",
    });
    await deleteIncome(userId, { id: row.id });

    expect(await listRecentIncomeNameSuggestions(userId, 2026, 8)).toEqual([]);
  });
});

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
      `[integration] Postgres unreachable, skipping UC-30 suite: ${(err as Error).message}\n`,
    );
    return false;
  }
}

async function truncateAllTenantTables(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE app_user CASCADE`);
}
