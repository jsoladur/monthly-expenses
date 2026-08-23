import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { monthActualExpense, monthFixedLine } from "@/server/db/schema";
import { createCategory } from "@/server/services/categories";
import { createTemplate } from "@/server/services/templates";
import { createMonth } from "@/server/services/months";
import {
  EstimatedLineCannotPassError,
  MonthLineNotFoundError,
  NotUndoableError,
  UndoForbiddenAfterEditError,
  ActualNotFoundOnUndoError,
  passToActual,
  undoPassToActual,
} from "@/server/services/pass-to-actual";
import * as actualRepo from "@/server/repositories/actual";

// ============================================================================
// UC-10 pass-to-actual & undo — integration (PRD §7.5, §7.2, §13, UC-12, ARCH
// §4 / §5).
//
// Hits the real Postgres the migration suite created. Skipped (not failed)
// when the database is unreachable so `pnpm test` stays usable without
// Docker.
//
// Acceptance (PRD §15 #8, #9, #10, #12 + §7.5 / §7.2 / §7.8):
//   - passToActual: ONLY `kind = 'committed'` lines qualify; estimated
//     lines throw `EstimatedLineCannotPassError` (PRD §7.5, #12). The new
//     actual's amount = line.remaining_amount, copies category_id / name /
//     observations verbatim, stores converted_from_line_id, and sets
//     edited_after_conversion = false so undo is allowed (#8, #9).
//   - passToActual: HARD-deletes the source line (PRD C15 / §13) — after
//     the move, the line is gone from `month_fixed_line` and only lives in
//     `month_actual_expense`. The savings algebra is unchanged because
//     the money lives in exactly one place (#8).
//   - passToActual: NEGATIVE remaining values are passed through (PRD §7.6).
//   - undoPassToActual: allowed ONLY if converted_from_line_id IS NOT NULL
//     AND edited_after_conversion = false. Restores the line with
//     remaining_amount = current actual.amount, original_amount =
//     converted_line_original_amount, kind = 'committed', origin =
//     converted_line_origin, re-using the original line id (#9).
//   - undoPassToActual: rejected with UndoForbiddenAfterEditError when
//     edited_after_conversion = true (PRD §7.5, #10).
//   - undoPassToActual: rejected with NotUndoableError when the actual was
//     NOT created by pass-to-actual (converted_from_line_id IS NULL).
//   - passToActual + undoPassToActual: each runs in ONE transaction. A
//     failure mid-way leaves no orphan row in either table (ARCH §5,
//     PRD §16).
//   - Tenancy: every read/write joins on month.user_id (PRD §5.1, UC-17).
//   - Templates are NEVER mutated by either operation (PRD §7.8).
// ============================================================================

const reachable = await pingDatabase();

const suite = reachable ? describe : describe.skip;

suite("UC-10 pass-to-actual & undo", () => {
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

  // --------------------------------------------------------------------------
  // passToActual
  // --------------------------------------------------------------------------

  it("passes a committed line: moves to actuals, source hard-deleted (PRD §7.5, #8)", async () => {
    const userId = await seedUser("google-sub-uc10-pass-happy");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Mortgage",
      amount: "800.00",
      kind: "committed",
    });
    await createMonth(userId, { year: 2026, month: 8 });
    const line = (await getMonthWorkspace(userId, 2026, 8)).lines[0]!;

    const actual = await passToActual(userId, { lineId: line.id });

    // The actual exists with the conversion metadata.
    expect(actual.monthId).toBe(line.monthId);
    expect(actual.categoryId).toBe(line.categoryId);
    expect(actual.name).toBe(line.name);
    expect(actual.observations).toBe(line.observations);
    expect(actual.amount).toBe("800.00"); // = line.remaining_amount
    expect(actual.convertedFromLineId).toBe(line.id);
    expect(actual.convertedLineOriginalAmount).toBe("800.00"); // = line.original_amount
    expect(actual.convertedLineOrigin).toBe("cloned");
    expect(actual.editedAfterConversion).toBe(false);

    // The source line is HARD-deleted (PRD C15 / §13).
    const workspace = await getMonthWorkspace(userId, 2026, 8);
    expect(workspace.lines.find((l) => l.id === line.id)).toBeUndefined();
    expect(workspace.actuals).toHaveLength(1);
    expect(workspace.actuals[0]!.id).toBe(actual.id);

    // And the row is physically gone from month_fixed_line.
    const rows = await db
      .select()
      .from(monthFixedLine)
      .where(sql`id = ${line.id}`);
    expect(rows).toHaveLength(0);
  });

  it("passes a committed line with negative remaining (PRD §7.6)", async () => {
    const userId = await seedUser("google-sub-uc10-pass-negative");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Mortgage",
      amount: "800.00",
      kind: "committed",
    });
    await createMonth(userId, { year: 2026, month: 8 });
    const line = (await getMonthWorkspace(userId, 2026, 8)).lines[0]!;

    await db
      .update(monthFixedLine)
      .set({ remainingAmount: "-20.00" })
      .where(sql`id = ${line.id}`);

    const actual = await passToActual(userId, { lineId: line.id });

    expect(actual.amount).toBe("-20.00");
    expect(actual.convertedLineOriginalAmount).toBe("800.00");
  });

  it("passes a committed line keeping observations verbatim (PRD §6.6)", async () => {
    const userId = await seedUser("google-sub-uc10-pass-obs");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Mortgage",
      amount: "800.00",
      kind: "committed",
      observations: "Primary residence",
    });
    await createMonth(userId, { year: 2026, month: 8 });
    const line = (await getMonthWorkspace(userId, 2026, 8)).lines[0]!;

    const actual = await passToActual(userId, { lineId: line.id });

    expect(actual.observations).toBe("Primary residence");
  });

  it("passes a committed MONTH-ONLY line (origin=month_only, cloned in spirit) — §7.5 forbids ONLY by kind, not origin", async () => {
    const userId = await seedUser("google-sub-uc10-pass-month-only-committed");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    const created = await createMonth(userId, { year: 2026, month: 8 });
    const { addMonthOnlyLine } = await import("@/server/services/reserved-lines");
    const added = await addMonthOnlyLine(userId, {
      monthId: created.id,
      categoryId: groceries.id,
      name: "One-off insurance",
      amount: "120.00",
      kind: "committed",
    });

    const actual = await passToActual(userId, { lineId: added.id });

    expect(actual.amount).toBe("120.00");
    expect(actual.convertedFromLineId).toBe(added.id);
    expect(actual.convertedLineOrigin).toBe("month_only");
    expect(actual.editedAfterConversion).toBe(false);
  });

  it("rejects passToActual on an ESTIMATED line with EstimatedLineCannotPassError (PRD §7.5, #12)", async () => {
    const userId = await seedUser("google-sub-uc10-rejects-estimated");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Groceries",
      amount: "400.00",
      kind: "estimated",
    });
    await createMonth(userId, { year: 2026, month: 8 });
    const line = (await getMonthWorkspace(userId, 2026, 8)).lines[0]!;
    expect(line.kind).toBe("estimated");

    await expect(passToActual(userId, { lineId: line.id })).rejects.toBeInstanceOf(
      EstimatedLineCannotPassError,
    );

    // The line is still there — pass was rejected before any write.
    const workspace = await getMonthWorkspace(userId, 2026, 8);
    expect(workspace.lines.find((l) => l.id === line.id)).toBeDefined();
    expect(workspace.actuals).toHaveLength(0);
  });

  it("rejects passToActual on a missing line with MonthLineNotFoundError (PRD §5.1)", async () => {
    const userId = await seedUser("google-sub-uc10-missing-line");

    await expect(
      passToActual(userId, {
        lineId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toBeInstanceOf(MonthLineNotFoundError);
  });

  it("rejects passToActual on a line belonging to another tenant (PRD §5.1, UC-17)", async () => {
    const alice = await seedUser("google-sub-uc10-iso-alice");
    const bob = await seedUser("google-sub-uc10-iso-bob");
    const groceries = await createCategory(alice, { kind: "expense", name: "Groceries" });
    await createTemplate(alice, {
      categoryId: groceries.id,
      name: "Mortgage",
      amount: "800.00",
      kind: "committed",
    });
    await createMonth(alice, { year: 2026, month: 8 });
    const aliceLine = (await getMonthWorkspace(alice, 2026, 8)).lines[0]!;

    await expect(passToActual(bob, { lineId: aliceLine.id })).rejects.toBeInstanceOf(
      MonthLineNotFoundError,
    );

    // Alice's line is untouched.
    const workspace = await getMonthWorkspace(alice, 2026, 8);
    expect(workspace.lines.find((l) => l.id === aliceLine.id)).toBeDefined();
    expect(workspace.actuals).toHaveLength(0);
  });

  it("passToAtomic is atomic: a mid-tx failure rolls back BOTH writes (ARCH §5, PRD §16)", async () => {
    const userId = await seedUser("google-sub-uc10-pass-atomic");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Mortgage",
      amount: "800.00",
      kind: "committed",
    });
    await createMonth(userId, { year: 2026, month: 8 });
    const line = (await getMonthWorkspace(userId, 2026, 8)).lines[0]!;

    // Force the actual insert to blow up. The tx must roll back so the line
    // is NOT deleted — otherwise we'd have an orphan deleted line + no
    // actual (PRD §16, ARCH §5).
    const spy = vi.spyOn(actualRepo, "insertActual");
    spy.mockImplementationOnce(() => {
      throw new Error("boom: simulated insert failure");
    });

    await expect(passToActual(userId, { lineId: line.id })).rejects.toThrow(
      /boom: simulated insert failure/,
    );

    // Line STILL exists (rollback worked) and no actual was created.
    const workspace = await getMonthWorkspace(userId, 2026, 8);
    expect(workspace.lines.find((l) => l.id === line.id)).toBeDefined();
    expect(workspace.actuals).toHaveLength(0);
  });

  it("passToActual preserves the source template untouched (PRD §7.8)", async () => {
    const userId = await seedUser("google-sub-uc10-no-template-mutation");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    const template = await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Mortgage",
      amount: "800.00",
      kind: "committed",
    });
    await createMonth(userId, { year: 2026, month: 8 });
    const line = (await getMonthWorkspace(userId, 2026, 8)).lines[0]!;

    await passToActual(userId, { lineId: line.id });

    const { findTemplateById } = await import("@/server/repositories/template");
    const reloaded = await findTemplateById(userId, template.id);
    expect(reloaded!.amount).toBe("800.00");
    expect(reloaded!.active).toBe(true);
  });

  // --------------------------------------------------------------------------
  // undoPassToActual
  // --------------------------------------------------------------------------

  it("undoPassToActual restores the committed line when the actual is unedited (PRD §7.5, #9)", async () => {
    const userId = await seedUser("google-sub-uc10-undo-happy");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Mortgage",
      amount: "800.00",
      kind: "committed",
    });
    await createMonth(userId, { year: 2026, month: 8 });
    const line = (await getMonthWorkspace(userId, 2026, 8)).lines[0]!;

    const actual = await passToActual(userId, { lineId: line.id });

    const restoredId = await undoPassToActual(userId, { actualId: actual.id });

    // Same id is reused so the conversion link remains stable.
    expect(restoredId).toBe(line.id);

    const workspace = await getMonthWorkspace(userId, 2026, 8);
    const restored = workspace.lines.find((l) => l.id === line.id)!;
    expect(restored).toBeDefined();
    expect(restored.kind).toBe("committed");
    expect(restored.origin).toBe("cloned");
    expect(restored.remainingAmount).toBe("800.00"); // = actual.amount at undo time
    expect(restored.originalAmount).toBe("800.00"); // = converted_line_original_amount
    expect(restored.name).toBe(line.name);
    expect(restored.categoryId).toBe(line.categoryId);

    // The actual is HARD-deleted.
    expect(workspace.actuals.find((a) => a.id === actual.id)).toBeUndefined();
    const rows = await db
      .select()
      .from(monthActualExpense)
      .where(sql`id = ${actual.id}`);
    expect(rows).toHaveLength(0);
  });

  it("undoPassToActual restores an edited remaining if the actual amount was changed mid-flight (PRD §7.5)", async () => {
    // Sanity check: undo can fire ONLY while the actual is unedited. This
    // test path sets up a line whose original_amount != remaining_amount
    // BEFORE the pass. After undo, remaining_amount = actual.amount (unchanged
    // because undo was immediate), original_amount = converted_line_original_amount.
    const userId = await seedUser("google-sub-uc10-undo-amounts");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Mortgage",
      amount: "800.00",
      kind: "committed",
    });
    await createMonth(userId, { year: 2026, month: 8 });
    const line = (await getMonthWorkspace(userId, 2026, 8)).lines[0]!;

    // Drop remaining BEFORE pass so remaining=750.00, original=800.00.
    await db
      .update(monthFixedLine)
      .set({ remainingAmount: "750.00" })
      .where(sql`id = ${line.id}`);

    const actual = await passToActual(userId, { lineId: line.id });
    expect(actual.amount).toBe("750.00");
    expect(actual.convertedLineOriginalAmount).toBe("800.00");

    await undoPassToActual(userId, { actualId: actual.id });
    const restored = (await getMonthWorkspace(userId, 2026, 8)).lines[0]!;
    expect(restored.remainingAmount).toBe("750.00");
    expect(restored.originalAmount).toBe("800.00");
  });

  it("undoPassToActual rejects when the actual was edited after the pass (PRD §7.5, #10)", async () => {
    const userId = await seedUser("google-sub-uc10-undo-after-edit");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Mortgage",
      amount: "800.00",
      kind: "committed",
    });
    await createMonth(userId, { year: 2026, month: 8 });
    const line = (await getMonthWorkspace(userId, 2026, 8)).lines[0]!;

    const actual = await passToActual(userId, { lineId: line.id });

    // User edits the actual → edited_after_conversion = true (UC-08 sets it).
    const { editActual } = await import("@/server/services/actuals");
    await editActual(userId, {
      id: actual.id,
      categoryId: groceries.id,
      name: actual.name,
      amount: "820.00",
    });

    await expect(undoPassToActual(userId, { actualId: actual.id })).rejects.toBeInstanceOf(
      UndoForbiddenAfterEditError,
    );

    // Both rows are intact — undo was rejected before any write.
    const workspace = await getMonthWorkspace(userId, 2026, 8);
    expect(workspace.lines).toHaveLength(0);
    expect(workspace.actuals.find((a) => a.id === actual.id)).toBeDefined();
    expect(workspace.actuals[0]!.amount).toBe("820.00");
    expect(workspace.actuals[0]!.editedAfterConversion).toBe(true);
  });

  it("undoPassToActual rejects when the actual was not created by pass-to-actual (PRD §7.5)", async () => {
    const userId = await seedUser("google-sub-uc10-undo-not-converted");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    await createMonth(userId, { year: 2026, month: 8 });
    const { addActual } = await import("@/server/services/actuals");
    const actual = await addActual(userId, {
      monthId: (await getMonthWorkspace(userId, 2026, 8)).month.id,
      categoryId: groceries.id,
      name: "Manual ticket",
      amount: "10.00",
    });
    expect(actual.convertedFromLineId).toBeNull();

    await expect(undoPassToActual(userId, { actualId: actual.id })).rejects.toBeInstanceOf(
      NotUndoableError,
    );

    // The actual is untouched.
    const workspace = await getMonthWorkspace(userId, 2026, 8);
    expect(workspace.actuals.find((a) => a.id === actual.id)).toBeDefined();
    expect(workspace.lines).toHaveLength(0);
  });

  it("undoPassToActual rejects a missing actual with ActualNotFoundOnUndoError (PRD §5.1)", async () => {
    const userId = await seedUser("google-sub-uc10-undo-missing");

    await expect(
      undoPassToActual(userId, {
        actualId: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toBeInstanceOf(ActualNotFoundOnUndoError);
  });

  it("undoPassToActual rejects an actual belonging to another tenant (PRD §5.1, UC-17)", async () => {
    const alice = await seedUser("google-sub-uc10-undo-iso-alice");
    const bob = await seedUser("google-sub-uc10-undo-iso-bob");
    const groceries = await createCategory(alice, { kind: "expense", name: "Groceries" });
    await createTemplate(alice, {
      categoryId: groceries.id,
      name: "Mortgage",
      amount: "800.00",
      kind: "committed",
    });
    await createMonth(alice, { year: 2026, month: 8 });
    const line = (await getMonthWorkspace(alice, 2026, 8)).lines[0]!;
    const actual = await passToActual(alice, { lineId: line.id });

    await expect(undoPassToActual(bob, { actualId: actual.id })).rejects.toBeInstanceOf(
      ActualNotFoundOnUndoError,
    );

    // Alice's actual is untouched.
    const workspace = await getMonthWorkspace(alice, 2026, 8);
    expect(workspace.actuals.find((a) => a.id === actual.id)).toBeDefined();
    expect(workspace.lines).toHaveLength(0);
  });

  it("undoPassToActual is atomic: a mid-tx failure rolls back BOTH writes (ARCH §5, PRD §16)", async () => {
    const userId = await seedUser("google-sub-uc10-undo-atomic");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Mortgage",
      amount: "800.00",
      kind: "committed",
    });
    await createMonth(userId, { year: 2026, month: 8 });
    const line = (await getMonthWorkspace(userId, 2026, 8)).lines[0]!;

    const actual = await passToActual(userId, { lineId: line.id });

    // Force the line re-insert to blow up. The tx must roll back so the
    // actual is NOT deleted — otherwise we'd have an orphan actual that
    // can't be undone (PRD §16, ARCH §5).
    const reservedRepo = await import("@/server/repositories/reserved-line");
    const spy = vi.spyOn(reservedRepo, "insertMonthLine");
    spy.mockImplementationOnce(() => {
      throw new Error("boom: simulated line insert failure");
    });

    await expect(undoPassToActual(userId, { actualId: actual.id })).rejects.toThrow(
      /boom: simulated line insert failure/,
    );

    // Actual STILL exists (rollback worked) and no line was created.
    const workspace = await getMonthWorkspace(userId, 2026, 8);
    expect(workspace.actuals.find((a) => a.id === actual.id)).toBeDefined();
    expect(workspace.lines).toHaveLength(0);
  });

  it("undoPassToActual preserves the source template untouched (PRD §7.8)", async () => {
    const userId = await seedUser("google-sub-uc10-undo-no-template-mutation");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    const template = await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Mortgage",
      amount: "800.00",
      kind: "committed",
    });
    await createMonth(userId, { year: 2026, month: 8 });
    const line = (await getMonthWorkspace(userId, 2026, 8)).lines[0]!;

    const actual = await passToActual(userId, { lineId: line.id });
    await undoPassToActual(userId, { actualId: actual.id });

    const { findTemplateById } = await import("@/server/repositories/template");
    const reloaded = await findTemplateById(userId, template.id);
    expect(reloaded!.amount).toBe("800.00");
    expect(reloaded!.active).toBe(true);
  });

  it("round-trip pass → undo leaves the month in its original shape (PRD §7.8)", async () => {
    const userId = await seedUser("google-sub-uc10-roundtrip");
    const groceries = await createCategory(userId, { kind: "expense", name: "Groceries" });
    await createTemplate(userId, {
      categoryId: groceries.id,
      name: "Mortgage",
      amount: "800.00",
      kind: "committed",
    });
    await createMonth(userId, { year: 2026, month: 8 });
    const before = await getMonthWorkspace(userId, 2026, 8);
    const line = before.lines[0]!;

    const actual = await passToActual(userId, { lineId: line.id });
    await undoPassToActual(userId, { actualId: actual.id });

    const after = await getMonthWorkspace(userId, 2026, 8);
    expect(after.lines).toHaveLength(1);
    const restored = after.lines[0]!;
    expect(restored.id).toBe(line.id);
    expect(restored.name).toBe(line.name);
    expect(restored.remainingAmount).toBe("800.00");
    expect(restored.originalAmount).toBe("800.00");
    expect(restored.kind).toBe("committed");
    expect(restored.origin).toBe("cloned");
    expect(restored.categoryId).toBe(line.categoryId);
    expect(after.actuals).toHaveLength(0);
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

async function pingDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch (err) {
    process.stderr.write(
      `[integration] Postgres unreachable, skipping UC-10 suite: ${(err as Error).message}\n`,
    );
    return false;
  }
}

async function truncateAllTenantTables(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE app_user CASCADE`);
}