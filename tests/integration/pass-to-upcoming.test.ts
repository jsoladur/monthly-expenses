import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { month, monthFixedLine } from "@/server/db/schema";
import { createCategory } from "@/server/services/categories";
import { createTemplate } from "@/server/services/templates";
import { createMonth } from "@/server/services/months";
import { addMonthOnlyLine, updateRemainingAmount } from "@/server/services/reserved-lines";
import {
  CommittedLineCannotPassToUpcomingError,
  MonthLineNotFoundError,
  NotCurrentYearError,
  TargetMonthNotFoundError,
  TargetNotUpcomingError,
  listUpcomingMonthsForPass,
  passToUpcomingMonth,
} from "@/server/services/pass-to-upcoming";

// ============================================================================
// UC-18 pass estimated line to an upcoming month (PRD UC-23 / C21 / §7.10).
// ============================================================================

const NOW_2026 = new Date("2026-09-12T12:00:00Z");
const NOW_2025 = new Date("2025-09-12T12:00:00Z");

const reachable = await pingDatabase();
const suite = reachable ? describe : describe.skip;

suite("UC-18 pass to upcoming month", () => {
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

  it("moves an estimated line to October: source hard-deleted, target month-only (PRD #29)", async () => {
    const userId = await seedUser("google-sub-uc18-happy");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Groceries",
      amount: "400.00",
      kind: "estimated",
      observations: "weekly shop",
    });
    const september = await createMonth(userId, { year: 2026, month: 9 });
    const october = await createMonth(userId, { year: 2026, month: 10 });
    const sourceLine = (await getMonthWorkspace(userId, 2026, 9)).lines.find(
      (l) => l.kind === "estimated",
    )!;
    await updateRemainingAmount(userId, {
      lineId: sourceLine.id,
      remainingAmount: "280.00",
    });

    const result = await passToUpcomingMonth(
      userId,
      { lineId: sourceLine.id, targetMonthId: october.id },
      NOW_2026,
    );

    expect(result.sourceYear).toBe(2026);
    expect(result.sourceMonth).toBe(9);
    expect(result.targetYear).toBe(2026);
    expect(result.targetMonth).toBe(10);
    expect(result.created.monthId).toBe(october.id);
    expect(result.created.name).toBe("Groceries");
    expect(result.created.observations).toBe("weekly shop");
    expect(result.created.categoryId).toBe(groceries.id);
    expect(result.created.kind).toBe("estimated");
    expect(result.created.origin).toBe("month_only");
    expect(result.created.remainingAmount).toBe("280.00");
    expect(result.created.originalAmount).toBe("280.00");

    const sourceWorkspace = await getMonthWorkspace(userId, 2026, 9);
    expect(sourceWorkspace.lines.find((l) => l.id === sourceLine.id)).toBeUndefined();

    const targetWorkspace = await getMonthWorkspace(userId, 2026, 10);
    const moved = targetWorkspace.lines.find((l) => l.id === result.created.id);
    expect(moved).toBeDefined();
    expect(moved!.origin).toBe("month_only");
    expect(targetWorkspace.lines.some((l) => l.origin === "cloned" && l.name === "Groceries")).toBe(
      true,
    );

    const gone = await db
      .select()
      .from(monthFixedLine)
      .where(sql`id = ${sourceLine.id}`);
    expect(gone).toHaveLength(0);

    const templates = await db.execute<{ n: string }>(
      sql`SELECT COUNT(*)::text AS n FROM template WHERE user_id = ${userId}`,
    );
    expect(templates[0]!.n).toBe("1");
    expect(sourceWorkspace.month.id).toBe(september.id);
  });

  it("does not leak across tenants (PRD #31)", async () => {
    const userA = await seedUser("google-sub-uc18-tenant-a");
    const userB = await seedUser("google-sub-uc18-tenant-b");
    const catA = await createCategory(userA, { kind: "expense", name: "Groceries" });
    const catB = await createCategory(userB, { kind: "expense", name: "Groceries" });
    await createTemplate(userA, {
      categoryId: catA.id,
      name: "Groceries",
      amount: "400.00",
      kind: "estimated",
    });
    await createTemplate(userB, {
      categoryId: catB.id,
      name: "Groceries",
      amount: "400.00",
      kind: "estimated",
    });
    await createMonth(userA, { year: 2026, month: 9 });
    const octoberA = await createMonth(userA, { year: 2026, month: 10 });
    await createMonth(userB, { year: 2026, month: 9 });
    const octoberB = await createMonth(userB, { year: 2026, month: 10 });
    const lineA = (await getMonthWorkspace(userA, 2026, 9)).lines[0]!;
    const lineB = (await getMonthWorkspace(userB, 2026, 9)).lines[0]!;

    await expect(
      passToUpcomingMonth(userB, { lineId: lineA.id, targetMonthId: octoberB.id }, NOW_2026),
    ).rejects.toBeInstanceOf(MonthLineNotFoundError);

    await expect(
      passToUpcomingMonth(userB, { lineId: lineB.id, targetMonthId: octoberA.id }, NOW_2026),
    ).rejects.toBeInstanceOf(TargetMonthNotFoundError);

    await expect(
      passToUpcomingMonth(userA, { lineId: lineA.id, targetMonthId: octoberA.id }, NOW_2026),
    ).resolves.toBeDefined();
  });

  it("rejects a committed line without inserting on the target", async () => {
    const userId = await seedUser("google-sub-uc18-committed");
    const housing = await createCategory(userId, { kind: "expense", name: "Housing" });
    await createTemplate(userId, {
      categoryId: housing.id,
      name: "Mortgage",
      amount: "800.00",
      kind: "committed",
    });
    await createMonth(userId, { year: 2026, month: 9 });
    const october = await createMonth(userId, { year: 2026, month: 10 });
    const line = (await getMonthWorkspace(userId, 2026, 9)).lines[0]!;

    await expect(
      passToUpcomingMonth(userId, { lineId: line.id, targetMonthId: october.id }, NOW_2026),
    ).rejects.toBeInstanceOf(CommittedLineCannotPassToUpcomingError);

    const octoberLines = (await getMonthWorkspace(userId, 2026, 10)).lines;
    expect(octoberLines.filter((l) => l.origin === "month_only")).toHaveLength(0);
    expect((await getMonthWorkspace(userId, 2026, 9)).lines).toHaveLength(1);
  });

  it("rejects a target in another year, an earlier month, a missing target, and a missing line", async () => {
    const userId = await seedUser("google-sub-uc18-gates");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Groceries",
      amount: "400.00",
      kind: "estimated",
    });
    await createMonth(userId, { year: 2026, month: 9 });
    const august = await createMonth(userId, { year: 2026, month: 8 });
    const januaryNext = await createMonth(userId, { year: 2027, month: 1 });
    const line = (await getMonthWorkspace(userId, 2026, 9)).lines[0]!;
    const monthCountBefore = await countMonths(userId);

    await expect(
      passToUpcomingMonth(userId, { lineId: line.id, targetMonthId: januaryNext.id }, NOW_2026),
    ).rejects.toBeInstanceOf(TargetNotUpcomingError);

    await expect(
      passToUpcomingMonth(userId, { lineId: line.id, targetMonthId: august.id }, NOW_2026),
    ).rejects.toBeInstanceOf(TargetNotUpcomingError);

    await expect(
      passToUpcomingMonth(
        userId,
        { lineId: line.id, targetMonthId: "00000000-0000-4000-8000-000000000099" },
        NOW_2026,
      ),
    ).rejects.toBeInstanceOf(TargetMonthNotFoundError);

    await expect(
      passToUpcomingMonth(
        userId,
        { lineId: "00000000-0000-4000-8000-000000000098", targetMonthId: august.id },
        NOW_2026,
      ),
    ).rejects.toBeInstanceOf(MonthLineNotFoundError);

    expect(await countMonths(userId)).toBe(monthCountBefore);
    expect((await getMonthWorkspace(userId, 2026, 9)).lines).toHaveLength(1);
  });

  it("rejects a source month outside the current calendar year", async () => {
    const userId = await seedUser("google-sub-uc18-year");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Groceries",
      amount: "400.00",
      kind: "estimated",
    });
    await createMonth(userId, { year: 2025, month: 9 });
    const october = await createMonth(userId, { year: 2025, month: 10 });
    const line = (await getMonthWorkspace(userId, 2025, 9)).lines[0]!;

    await expect(
      passToUpcomingMonth(userId, { lineId: line.id, targetMonthId: october.id }, NOW_2026),
    ).rejects.toBeInstanceOf(NotCurrentYearError);
  });

  it("copies a negative remaining amount (PRD §7.6)", async () => {
    const userId = await seedUser("google-sub-uc18-negative");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    await createMonth(userId, { year: 2026, month: 9 });
    const october = await createMonth(userId, { year: 2026, month: 10 });
    const extra = await addMonthOnlyLine(userId, {
      monthId: (await getMonthWorkspace(userId, 2026, 9)).month.id,
      categoryId: groceries.id,
      name: "Refund envelope",
      amount: "-20.00",
      kind: "estimated",
    });

    const result = await passToUpcomingMonth(
      userId,
      { lineId: extra.id, targetMonthId: october.id },
      NOW_2026,
    );
    expect(result.created.remainingAmount).toBe("-20.00");
    expect(result.created.originalAmount).toBe("-20.00");
  });

  it("rolls back when the source delete fails (ARCH §5 atomicity)", async () => {
    const userId = await seedUser("google-sub-uc18-atomic");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Groceries",
      amount: "400.00",
      kind: "estimated",
    });
    await createMonth(userId, { year: 2026, month: 9 });
    const october = await createMonth(userId, { year: 2026, month: 10 });
    const line = (await getMonthWorkspace(userId, 2026, 9)).lines[0]!;

    const reservedRepo = await import("@/server/repositories/reserved-line");
    const spy = vi.spyOn(reservedRepo, "deleteMonthLine");
    spy.mockImplementationOnce(async () => {
      throw new Error("boom: simulated delete failure");
    });

    await expect(
      passToUpcomingMonth(userId, { lineId: line.id, targetMonthId: october.id }, NOW_2026),
    ).rejects.toThrow(/boom: simulated delete failure/);

    const source = await getMonthWorkspace(userId, 2026, 9);
    expect(source.lines.find((l) => l.id === line.id)).toBeDefined();
    const target = await getMonthWorkspace(userId, 2026, 10);
    expect(target.lines.filter((l) => l.origin === "month_only")).toHaveLength(0);
  });

  it("lists later months of the current year, chronological, and hides other years", async () => {
    const userId = await seedUser("google-sub-uc18-list");
    await createMonth(userId, { year: 2026, month: 9 });
    await createMonth(userId, { year: 2026, month: 11 });
    await createMonth(userId, { year: 2026, month: 10 });
    await createMonth(userId, { year: 2025, month: 12 });

    const listed = await listUpcomingMonthsForPass(userId, 2026, 9, NOW_2026);
    expect(listed.map((m) => m.month)).toEqual([10, 11]);

    const hidden = await listUpcomingMonthsForPass(userId, 2026, 9, NOW_2025);
    expect(hidden).toEqual([]);

    const december = await listUpcomingMonthsForPass(userId, 2026, 12, NOW_2026);
    expect(december).toEqual([]);
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

async function countMonths(userId: string): Promise<number> {
  const rows = await db
    .select()
    .from(month)
    .where(eq(month.userId, userId));
  return rows.length;
}

async function pingDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch (err) {
    process.stderr.write(
      `[integration] Postgres unreachable, skipping UC-18 suite: ${(err as Error).message}\n`,
    );
    return false;
  }
}

async function truncateAllTenantTables(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE app_user CASCADE`);
}
