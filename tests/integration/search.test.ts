import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { foldAccents, SQL_ACCENT_FROM, SQL_ACCENT_TO } from "@/server/search/sanitize";
import * as searchRepo from "@/server/repositories/search";
import { searchActuals } from "@/server/services/search";
import { createCategory, deactivateCategory } from "@/server/services/categories";
import { createMonth } from "@/server/services/months";
import { addActual, deleteActual } from "@/server/services/actuals";
import { addIncome } from "@/server/services/incomes";
import { addMonthOnlyLine } from "@/server/services/reserved-lines";

const reachable = await pingDatabase();
const suite = reachable ? describe : describe.skip;

suite("UC-16 search actuals", () => {
  beforeAll(async () => {
    await truncateAllTenantTables();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await truncateAllTenantTables();
  });

  afterAll(async () => {
    await db.$client.end({ timeout: 1 });
  });

  it("never returns another tenant's tickets (PRD §15 #23)", async () => {
    const alice = await seedUser("google-sub-uc16-iso-alice");
    const bob = await seedUser("google-sub-uc16-iso-bob");
    const aliceCat = await createCategory(alice, { kind: "expense", name: "Food" });
    const aliceMonth = await createMonth(alice, { year: 2026, month: 3 });
    await addActual(alice, {
      monthId: aliceMonth.id,
      categoryId: aliceCat.id,
      name: "Café Central",
      amount: "4.50",
    });
    const bobCat = await createCategory(bob, { kind: "expense", name: "Food" });
    const bobMonth = await createMonth(bob, { year: 2026, month: 3 });
    await addActual(bob, {
      monthId: bobMonth.id,
      categoryId: bobCat.id,
      name: "Weekly shop",
      amount: "12.00",
    });

    const result = await searchActuals(bob, "cafe");
    expect(result.status).toBe("empty");
  });

  it("matches a stored accented name with a folded query", async () => {
    const userId = await seedUser("google-sub-uc16-accent");
    const cat = await createCategory(userId, { kind: "expense", name: "Food" });
    const created = await createMonth(userId, { year: 2026, month: 3 });
    await addActual(userId, {
      monthId: created.id,
      categoryId: cat.id,
      name: "Café Central",
      amount: "4.50",
    });

    const result = await searchActuals(userId, "cafe");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.name).toBe("Café Central");
    expect(result.hits[0]!.amountCents).toBe(450);
  });

  it("matches observations when the name does not contain the term", async () => {
    const userId = await seedUser("google-sub-uc16-obs");
    const cat = await createCategory(userId, { kind: "expense", name: "Food" });
    const created = await createMonth(userId, { year: 2026, month: 3 });
    await addActual(userId, {
      monthId: created.id,
      categoryId: cat.id,
      name: "Weekly shop",
      observations: "oat milk",
      amount: "3.20",
    });

    const result = await searchActuals(userId, "oat milk");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.observations).toBe("oat milk");
  });

  it("returns a row once when both name and observations match", async () => {
    const userId = await seedUser("google-sub-uc16-or");
    const cat = await createCategory(userId, { kind: "expense", name: "Food" });
    const created = await createMonth(userId, { year: 2026, month: 3 });
    await addActual(userId, {
      monthId: created.id,
      categoryId: cat.id,
      name: "Café Central",
      observations: "love this cafe",
      amount: "4.50",
    });

    const result = await searchActuals(userId, "cafe");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.hits).toHaveLength(1);
  });

  it("does not treat % as a glob after sanitize/escape", async () => {
    const userId = await seedUser("google-sub-uc16-wild");
    const cat = await createCategory(userId, { kind: "expense", name: "Food" });
    const created = await createMonth(userId, { year: 2026, month: 3 });
    await addActual(userId, {
      monthId: created.id,
      categoryId: cat.id,
      name: "Weekly shop",
      amount: "10.00",
    });
    await addActual(userId, {
      monthId: created.id,
      categoryId: cat.id,
      name: "%all% extra",
      amount: "1.00",
    });

    const glob = await searchActuals(userId, "%");
    expect(glob.status).toBe("tooShort");

    const literal = await searchActuals(userId, "%all%");
    expect(literal.status).toBe("ok");
    if (literal.status !== "ok") return;
    expect(literal.hits).toHaveLength(1);
    expect(literal.hits[0]!.name).toBe("%all% extra");
  });

  it("does not hit the database for a two-letter query", async () => {
    const userId = await seedUser("google-sub-uc16-short");
    const spy = vi.spyOn(searchRepo, "searchActualsByText");
    const result = await searchActuals(userId, "ab");
    expect(result.status).toBe("tooShort");
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not hit the database for idle whitespace", async () => {
    const userId = await seedUser("google-sub-uc16-idle");
    const spy = vi.spyOn(searchRepo, "searchActualsByText");
    const result = await searchActuals(userId, "   ");
    expect(result.status).toBe("idle");
    expect(spy).not.toHaveBeenCalled();
  });

  it("drops a hard-deleted actual (PRD §15 #25)", async () => {
    const userId = await seedUser("google-sub-uc16-delete");
    const cat = await createCategory(userId, { kind: "expense", name: "Food" });
    const created = await createMonth(userId, { year: 2026, month: 3 });
    const actual = await addActual(userId, {
      monthId: created.id,
      categoryId: cat.id,
      name: "Café Central",
      amount: "4.50",
    });

    const before = await searchActuals(userId, "cafe");
    expect(before.status).toBe("ok");

    await deleteActual(userId, { id: actual.id });
    const after = await searchActuals(userId, "cafe");
    expect(after.status).toBe("empty");
  });

  it("returns tickets whose category is now inactive", async () => {
    const userId = await seedUser("google-sub-uc16-inactive");
    const cat = await createCategory(userId, { kind: "expense", name: "Food" });
    const created = await createMonth(userId, { year: 2026, month: 3 });
    await addActual(userId, {
      monthId: created.id,
      categoryId: cat.id,
      name: "Café Central",
      amount: "4.50",
    });
    await deactivateCategory(userId, { id: cat.id });

    const result = await searchActuals(userId, "cafe");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.hits[0]!.categoryActive).toBe(false);
    expect(result.hits[0]!.categoryName).toBe("Food");
  });

  it("does not return incomes or reserved lines with the same name", async () => {
    const userId = await seedUser("google-sub-uc16-scope");
    const expense = await createCategory(userId, { kind: "expense", name: "Food" });
    const income = await createCategory(userId, { kind: "income", name: "Salary" });
    const created = await createMonth(userId, { year: 2026, month: 3 });
    await addIncome(userId, {
      monthId: created.id,
      categoryId: income.id,
      name: "Café Central",
      amount: "100.00",
    });
    await addMonthOnlyLine(userId, {
      monthId: created.id,
      categoryId: expense.id,
      name: "Café Central",
      amount: "20.00",
      kind: "estimated",
    });

    const result = await searchActuals(userId, "cafe");
    expect(result.status).toBe("empty");
  });

  it("orders by newer year, then newer month, then newer created_at", async () => {
    const userId = await seedUser("google-sub-uc16-order");
    const cat = await createCategory(userId, { kind: "expense", name: "Food" });
    const jan = await createMonth(userId, { year: 2025, month: 1 });
    const feb = await createMonth(userId, { year: 2026, month: 2 });
    const mar = await createMonth(userId, { year: 2026, month: 3 });

    const olderFeb = await addActual(userId, {
      monthId: feb.id,
      categoryId: cat.id,
      name: "Café older Feb",
      amount: "1.00",
    });
    const newerFeb = await addActual(userId, {
      monthId: feb.id,
      categoryId: cat.id,
      name: "Café newer Feb",
      amount: "2.00",
    });
    await addActual(userId, {
      monthId: jan.id,
      categoryId: cat.id,
      name: "Café Jan",
      amount: "3.00",
    });
    await addActual(userId, {
      monthId: mar.id,
      categoryId: cat.id,
      name: "Café Mar",
      amount: "4.00",
    });

    await db.execute(sql`
      UPDATE month_actual_expense SET created_at = '2026-02-01T10:00:00Z' WHERE id = ${olderFeb.id}
    `);
    await db.execute(sql`
      UPDATE month_actual_expense SET created_at = '2026-02-01T12:00:00Z' WHERE id = ${newerFeb.id}
    `);

    const result = await searchActuals(userId, "cafe");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.hits.map((h) => h.name)).toEqual([
      "Café Mar",
      "Café newer Feb",
      "Café older Feb",
      "Café Jan",
    ]);
  });

  it("caps at 100 hits and sets truncated when 101 match", async () => {
    const userId = await seedUser("google-sub-uc16-cap");
    const cat = await createCategory(userId, { kind: "expense", name: "Food" });
    const created = await createMonth(userId, { year: 2026, month: 3 });
    for (let i = 0; i < 101; i += 1) {
      await addActual(userId, {
        monthId: created.id,
        categoryId: cat.id,
        name: `Café batch ${i}`,
        amount: "1.00",
      });
    }

    const result = await searchActuals(userId, "cafe");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.hits).toHaveLength(100);
    expect(result.truncated).toBe(true);
  });

  it("folds the same fixture in TypeScript and SQL translate", async () => {
    const fixture = "Café niño ü ç ÁÉÍÓÚ";
    const rows = await db.execute<{ folded: string }>(sql`
      SELECT translate(lower(${fixture}), ${SQL_ACCENT_FROM}, ${SQL_ACCENT_TO}) AS folded
    `);
    expect(rows[0]!.folded).toBe(foldAccents(fixture));
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
      `[integration] Postgres unreachable, skipping UC-16 suite: ${(err as Error).message}\n`,
    );
    return false;
  }
}

async function truncateAllTenantTables(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE app_user CASCADE`);
}
