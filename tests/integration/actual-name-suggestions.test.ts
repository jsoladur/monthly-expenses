import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { createCategory } from "@/server/services/categories";
import { createMonth } from "@/server/services/months";
import {
  addActual,
  deleteActual,
  listRecentActualNameSuggestions,
} from "@/server/services/actuals";
import { addIncome } from "@/server/services/incomes";
import { addMonthOnlyLine } from "@/server/services/reserved-lines";

const reachable = await pingDatabase();
const suite = reachable ? describe : describe.skip;

suite("UC-17 actual name suggestions", () => {
  beforeAll(async () => {
    await truncateAllTenantTables();
  });

  afterEach(async () => {
    await truncateAllTenantTables();
  });

  afterAll(async () => {
    await db.$client.end({ timeout: 1 });
  });

  it("never returns another tenant's names (PRD §15 #27)", async () => {
    const alice = await seedUser("google-sub-uc17-iso-alice");
    const bob = await seedUser("google-sub-uc17-iso-bob");
    const aliceCat = await createCategory(alice, { kind: "expense", name: "Food" });
    const aliceMonth = await createMonth(alice, { year: 2026, month: 8 });
    await addActual(alice, {
      monthId: aliceMonth.id,
      categoryId: aliceCat.id,
      name: "Café Central",
      amount: "4.50",
    });
    const bobCat = await createCategory(bob, { kind: "expense", name: "Food" });
    const bobMonth = await createMonth(bob, { year: 2026, month: 8 });
    await addActual(bob, {
      monthId: bobMonth.id,
      categoryId: bobCat.id,
      name: "Weekly shop",
      amount: "12.00",
    });

    const bobNames = await listRecentActualNameSuggestions(bob, 2026, 8);
    expect(bobNames.map((n) => n.name)).toEqual(["Weekly shop"]);
    expect(bobNames.map((n) => n.name)).not.toContain("Café Central");
  });

  it("includes June in an August window and excludes May (PRD §15 #26)", async () => {
    const userId = await seedUser("google-sub-uc17-window");
    const cat = await createCategory(userId, { kind: "expense", name: "Food" });
    const august = await createMonth(userId, { year: 2026, month: 8 });
    const june = await createMonth(userId, { year: 2026, month: 6 });
    const may = await createMonth(userId, { year: 2026, month: 5 });
    await addActual(userId, {
      monthId: june.id,
      categoryId: cat.id,
      name: "Café Central",
      amount: "4.50",
    });
    await addActual(userId, {
      monthId: may.id,
      categoryId: cat.id,
      name: "Carrefour",
      amount: "20.00",
    });
    await addActual(userId, {
      monthId: august.id,
      categoryId: cat.id,
      name: "Pan",
      amount: "1.20",
    });

    const names = await listRecentActualNameSuggestions(userId, 2026, 8);
    expect(names.map((n) => n.name)).toEqual(["Pan", "Café Central"]);
  });

  it("collapses duplicate folded names to the newest spelling", async () => {
    const userId = await seedUser("google-sub-uc17-dedupe");
    const cat = await createCategory(userId, { kind: "expense", name: "Food" });
    const july = await createMonth(userId, { year: 2026, month: 7 });
    const august = await createMonth(userId, { year: 2026, month: 8 });
    await addActual(userId, {
      monthId: july.id,
      categoryId: cat.id,
      name: "Café",
      amount: "3.00",
    });
    await addActual(userId, {
      monthId: august.id,
      categoryId: cat.id,
      name: "cafe",
      amount: "3.10",
    });

    const names = await listRecentActualNameSuggestions(userId, 2026, 8);
    expect(names).toHaveLength(1);
    expect(names[0]!.name).toBe("cafe");
    expect(names[0]!.month).toBe(8);
  });

  it("does not include incomes or reserved lines with the same name", async () => {
    const userId = await seedUser("google-sub-uc17-kinds");
    const expense = await createCategory(userId, { kind: "expense", name: "Food" });
    const income = await createCategory(userId, { kind: "income", name: "Salary" });
    const august = await createMonth(userId, { year: 2026, month: 8 });
    await addIncome(userId, {
      monthId: august.id,
      categoryId: income.id,
      name: "Payroll",
      amount: "2000.00",
    });
    await addMonthOnlyLine(userId, {
      monthId: august.id,
      categoryId: expense.id,
      name: "Envelope",
      amount: "50.00",
      kind: "estimated",
    });
    await addActual(userId, {
      monthId: august.id,
      categoryId: expense.id,
      name: "Bread",
      amount: "2.00",
    });

    const names = await listRecentActualNameSuggestions(userId, 2026, 8);
    expect(names.map((n) => n.name)).toEqual(["Bread"]);
  });

  it("drops a hard-deleted actual from the corpus (PRD C15)", async () => {
    const userId = await seedUser("google-sub-uc17-delete");
    const cat = await createCategory(userId, { kind: "expense", name: "Food" });
    const august = await createMonth(userId, { year: 2026, month: 8 });
    const ticket = await addActual(userId, {
      monthId: august.id,
      categoryId: cat.id,
      name: "Pharmacy",
      amount: "8.00",
    });
    await deleteActual(userId, { id: ticket.id });

    const names = await listRecentActualNameSuggestions(userId, 2026, 8);
    expect(names).toEqual([]);
  });

  it("returns August tickets when July and June were never created (C6)", async () => {
    const userId = await seedUser("google-sub-uc17-missing");
    const cat = await createCategory(userId, { kind: "expense", name: "Food" });
    const august = await createMonth(userId, { year: 2026, month: 8 });
    await addActual(userId, {
      monthId: august.id,
      categoryId: cat.id,
      name: "Bread",
      amount: "2.00",
    });

    const names = await listRecentActualNameSuggestions(userId, 2026, 8);
    expect(names.map((n) => n.name)).toEqual(["Bread"]);
    const monthCount = await db.execute<{ n: string }>(
      sql`SELECT COUNT(*)::text AS n FROM month WHERE user_id = ${userId}`,
    );
    expect(monthCount[0]?.n).toBe("1");
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
      `[integration] Postgres unreachable, skipping UC-17 suite: ${(err as Error).message}\n`,
    );
    return false;
  }
}

async function truncateAllTenantTables(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE app_user CASCADE`);
}
