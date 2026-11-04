import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { createCategory, deactivateCategory } from "@/server/services/categories";
import { createTemplate } from "@/server/services/templates";
import { createMonth } from "@/server/services/months";
import { addActual, ActualNotFoundError, MonthNotFoundError } from "@/server/services/actuals";
import { addIncome } from "@/server/services/incomes";
import { getMonthSummary } from "@/server/services/summary";
import {
  passToActual,
  undoPassToActual,
  UndoForbiddenAfterEditError,
} from "@/server/services/pass-to-actual";
import {
  MoveTargetOutOfWindowError,
  listMoveTargets,
  moveActualToMonth,
} from "@/server/services/move-actual";

// ============================================================================
// UC-26 move an actual expense to another month (proposed PRD §15 #52–#57).
// ============================================================================

const reachable = await pingDatabase();
const suite = reachable ? describe : describe.skip;

suite("UC-26 move actual to another month", () => {
  beforeAll(async () => {
    await truncateAllTenantTables();
  });

  afterEach(async () => {
    await truncateAllTenantTables();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await db.$client.end({ timeout: 1 });
  });

  it("moves Dentist 90 from Nov to Dec keeping the row (#52)", async () => {
    const userId = await seedUser("google-sub-uc26-happy");
    const health = await createCategory(userId, { kind: "expense", name: "Health" });
    const salary = await createCategory(userId, { kind: "income", name: "Salary" });
    const nov = await createMonth(userId, { year: 2026, month: 11 });
    const dec = await createMonth(userId, { year: 2026, month: 12 });
    for (const m of [nov, dec]) {
      await addIncome(userId, {
        monthId: m.id,
        categoryId: salary.id,
        name: "Salary",
        amount: "1000.00",
      });
    }
    const ticket = await addActual(userId, {
      monthId: nov.id,
      categoryId: health.id,
      name: "Dentist",
      observations: "cleaning",
      amount: "90.00",
    });
    const novBefore = await getMonthSummary(userId, nov.id);
    const decBefore = await getMonthSummary(userId, dec.id);

    const result = await moveActualToMonth(userId, {
      actualId: ticket.id,
      targetMonthId: dec.id,
    });

    expect(result.from).toEqual({ year: 2026, month: 11 });
    expect(result.to).toEqual({ year: 2026, month: 12 });

    const novWs = await getMonthWorkspace(userId, 2026, 11);
    expect(novWs.actuals.find((a) => a.id === ticket.id)).toBeUndefined();
    const decWs = await getMonthWorkspace(userId, 2026, 12);
    const moved = decWs.actuals.find((a) => a.id === ticket.id)!;
    expect(moved).toBeDefined();
    expect(moved.categoryId).toBe(health.id);
    expect(moved.name).toBe("Dentist");
    expect(moved.observations).toBe("cleaning");
    expect(moved.amount).toBe("90.00");
    expect(moved.createdAt.getTime()).toBe(ticket.createdAt.getTime());

    const novAfter = await getMonthSummary(userId, nov.id);
    const decAfter = await getMonthSummary(userId, dec.id);
    expect(novAfter.potentialSavings - novBefore.potentialSavings).toBe(9000);
    expect(decAfter.potentialSavings - decBefore.potentialSavings).toBe(-9000);
  });

  it("allows up to 3 months back across years and rejects the 4th (#53)", async () => {
    const userId = await seedUser("google-sub-uc26-back");
    const cat = await createCategory(userId, { kind: "expense", name: "Food" });
    const oct = await createMonth(userId, { year: 2026, month: 10 });
    const nov = await createMonth(userId, { year: 2026, month: 11 });
    await createMonth(userId, { year: 2026, month: 12 });
    await createMonth(userId, { year: 2027, month: 1 });
    const feb = await createMonth(userId, { year: 2027, month: 2 });

    const targets = await listMoveTargets(userId, feb.id);
    expect(targets.previous.map((m) => `${m.year}-${m.month}`)).toEqual([
      "2027-1",
      "2026-12",
      "2026-11",
    ]);
    expect(targets.upcoming).toEqual([]);

    const t1 = await addActual(userId, {
      monthId: feb.id,
      categoryId: cat.id,
      name: "Late",
      amount: "10.00",
    });
    await expect(
      moveActualToMonth(userId, { actualId: t1.id, targetMonthId: oct.id }),
    ).rejects.toBeInstanceOf(MoveTargetOutOfWindowError);

    const res = await moveActualToMonth(userId, { actualId: t1.id, targetMonthId: nov.id });
    expect(res.to).toEqual({ year: 2026, month: 11 });
  });

  it("allows any later created month and never auto-creates (#54)", async () => {
    const userId = await seedUser("google-sub-uc26-fwd");
    const cat = await createCategory(userId, { kind: "expense", name: "Food" });
    const nov = await createMonth(userId, { year: 2026, month: 11 });
    const jan28 = await createMonth(userId, { year: 2028, month: 1 });

    const targets = await listMoveTargets(userId, nov.id);
    expect(targets.upcoming.map((m) => m.id)).toEqual([jan28.id]);

    const ticket = await addActual(userId, {
      monthId: nov.id,
      categoryId: cat.id,
      name: "Deferred",
      amount: "50.00",
    });
    await moveActualToMonth(userId, { actualId: ticket.id, targetMonthId: jan28.id });

    await expect(
      moveActualToMonth(userId, {
        actualId: ticket.id,
        targetMonthId: "00000000-0000-4000-8000-000000000099",
      }),
    ).rejects.toBeInstanceOf(MonthNotFoundError);
    const count = await db.execute<{ n: string }>(
      sql`SELECT COUNT(*)::text AS n FROM month WHERE user_id = ${userId}`,
    );
    expect(count[0]!.n).toBe("2");
  });

  it("rejects the same month and lists nothing when the window is empty (#55)", async () => {
    const userId = await seedUser("google-sub-uc26-same");
    const cat = await createCategory(userId, { kind: "expense", name: "Food" });
    await createMonth(userId, { year: 2026, month: 6 });
    const nov = await createMonth(userId, { year: 2026, month: 11 });
    const ticket = await addActual(userId, {
      monthId: nov.id,
      categoryId: cat.id,
      name: "Bread",
      amount: "2.00",
    });

    await expect(
      moveActualToMonth(userId, { actualId: ticket.id, targetMonthId: nov.id }),
    ).rejects.toBeInstanceOf(MoveTargetOutOfWindowError);

    expect(await listMoveTargets(userId, nov.id)).toEqual({ previous: [], upcoming: [] });
  });

  it("moves a ticket whose category is now inactive", async () => {
    const userId = await seedUser("google-sub-uc26-inactive");
    const cat = await createCategory(userId, { kind: "expense", name: "Old" });
    const nov = await createMonth(userId, { year: 2026, month: 11 });
    const dec = await createMonth(userId, { year: 2026, month: 12 });
    const ticket = await addActual(userId, {
      monthId: nov.id,
      categoryId: cat.id,
      name: "Legacy",
      amount: "5.00",
    });
    await deactivateCategory(userId, { id: cat.id });

    const res = await moveActualToMonth(userId, { actualId: ticket.id, targetMonthId: dec.id });
    expect(res.to).toEqual({ year: 2026, month: 12 });
  });

  it("drops the undo for a pass-to-actual ticket (#56)", async () => {
    const userId = await seedUser("google-sub-uc26-passed");
    const cat = await createCategory(userId, { kind: "expense", name: "Rent" });
    await createTemplate(userId, {
      categoryId: cat.id,
      name: "Rent",
      amount: "700.00",
      kind: "committed",
    });
    await createMonth(userId, { year: 2026, month: 11 });
    const dec = await createMonth(userId, { year: 2026, month: 12 });
    const nov = await getMonthWorkspace(userId, 2026, 11);
    const line = nov.lines.find((l) => l.kind === "committed")!;
    const passed = await passToActual(userId, { lineId: line.id });
    expect(passed.editedAfterConversion).toBe(false);
    const decLinesBefore = (await getMonthWorkspace(userId, 2026, 12)).lines.length;

    await moveActualToMonth(userId, { actualId: passed.id, targetMonthId: dec.id });

    const decWs = await getMonthWorkspace(userId, 2026, 12);
    const moved = decWs.actuals.find((a) => a.id === passed.id)!;
    expect(moved.editedAfterConversion).toBe(true);
    expect(moved.convertedFromLineId).toBe(line.id);
    await expect(
      undoPassToActual(userId, { actualId: passed.id }),
    ).rejects.toBeInstanceOf(UndoForbiddenAfterEditError);

    expect((await getMonthWorkspace(userId, 2026, 11)).lines).toHaveLength(0);
    expect(decWs.lines).toHaveLength(decLinesBefore);
  });

  it("isolates tenants (#57)", async () => {
    const userA = await seedUser("google-sub-uc26-a");
    const userB = await seedUser("google-sub-uc26-b");
    const catA = await createCategory(userA, { kind: "expense", name: "Food" });
    const catB = await createCategory(userB, { kind: "expense", name: "Food" });
    const novA = await createMonth(userA, { year: 2026, month: 11 });
    const decA = await createMonth(userA, { year: 2026, month: 12 });
    const novB = await createMonth(userB, { year: 2026, month: 11 });
    const decB = await createMonth(userB, { year: 2026, month: 12 });
    const ticketA = await addActual(userA, {
      monthId: novA.id,
      categoryId: catA.id,
      name: "A",
      amount: "1.00",
    });
    const ticketB = await addActual(userB, {
      monthId: novB.id,
      categoryId: catB.id,
      name: "B",
      amount: "1.00",
    });

    await expect(
      moveActualToMonth(userB, { actualId: ticketA.id, targetMonthId: decB.id }),
    ).rejects.toBeInstanceOf(ActualNotFoundError);
    await expect(
      moveActualToMonth(userB, { actualId: ticketB.id, targetMonthId: decA.id }),
    ).rejects.toBeInstanceOf(MonthNotFoundError);
    await expect(listMoveTargets(userB, novA.id)).rejects.toBeInstanceOf(MonthNotFoundError);

    expect((await getMonthWorkspace(userA, 2026, 11)).actuals.map((a) => a.id)).toEqual([
      ticketA.id,
    ]);
    expect((await getMonthWorkspace(userA, 2026, 12)).actuals).toHaveLength(0);
    expect((await getMonthWorkspace(userB, 2026, 11)).actuals.map((a) => a.id)).toEqual([
      ticketB.id,
    ]);
  });

  it("rolls back when the update fails (ARCH §5 atomicity)", async () => {
    const userId = await seedUser("google-sub-uc26-atomic");
    const cat = await createCategory(userId, { kind: "expense", name: "Food" });
    const nov = await createMonth(userId, { year: 2026, month: 11 });
    const dec = await createMonth(userId, { year: 2026, month: 12 });
    const ticket = await addActual(userId, {
      monthId: nov.id,
      categoryId: cat.id,
      name: "Bread",
      amount: "2.00",
    });
    const repo = await import("@/server/repositories/actual");
    vi.spyOn(repo, "moveActual").mockImplementationOnce(async () => {
      throw new Error("boom: simulated move failure");
    });

    await expect(
      moveActualToMonth(userId, { actualId: ticket.id, targetMonthId: dec.id }),
    ).rejects.toThrow(/boom/);
    expect((await getMonthWorkspace(userId, 2026, 11)).actuals).toHaveLength(1);
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

async function getMonthWorkspace(userId: string, year: number, monthValue: number) {
  const { getMonthWorkspace: service } = await import("@/server/services/months");
  return service(userId, year, monthValue);
}

async function pingDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch (err) {
    process.stderr.write(
      `[integration] Postgres unreachable, skipping UC-26 suite: ${(err as Error).message}\n`,
    );
    return false;
  }
}

async function truncateAllTenantTables(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE app_user CASCADE`);
}
