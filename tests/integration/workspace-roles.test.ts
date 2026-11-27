import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  CannotRemoveOwnerError,
  addMember,
  changeMemberRole,
  createSharedWorkspace,
  deleteWorkspace,
  getWorkspaceDetails,
  removeMember,
  renameWorkspace,
  setWorkspaceCurrency,
} from "@/server/services/workspaces";
import { loadWorkspaceAccess } from "@/server/auth/workspace-access";
import { WorkspaceForbiddenError, type WorkspaceAccess } from "@/lib/workspace-roles";
import {
  createCategory,
  deactivateCategory,
  listCategoriesForManagement,
  reactivateCategory,
  renameCategory,
  setCategorySavings,
} from "@/server/services/categories";
import {
  createTemplate,
  deactivateTemplate,
  deleteTemplate,
  listTemplatesForManagement,
  updateTemplate,
} from "@/server/services/templates";
import { createAnnual, deactivateAnnual, listAnnualsForManagement } from "@/server/services/annuals";
import { createMonth, deleteMonth, getMonthList, getMonthWorkspace } from "@/server/services/months";
import { addActual, deleteActual, editActual, listActualsForMonth } from "@/server/services/actuals";
import { addIncome, deleteIncome } from "@/server/services/incomes";
import { addMonthOnlyLine, deleteMonthLine, updateRemainingAmount } from "@/server/services/reserved-lines";
import { passToActual, undoPassToActual } from "@/server/services/pass-to-actual";
import { moveActualToMonth } from "@/server/services/move-actual";
import { passToUpcomingMonth } from "@/server/services/pass-to-upcoming";
import { applyEstimateSuggestion, getEstimateCheck } from "@/server/services/estimate-check";
import { getMonthSummary, getOverspendWarnings } from "@/server/services/summary";
import { getGlobalStatsPage } from "@/server/services/global-stats";
import { searchActuals } from "@/server/services/search";
import { resolveExportMonths } from "@/server/services/export";
import { parseAllowlist } from "@/server/auth/allowlist";
import { seedOwnerAccess } from "./_helpers/workspace";

// ============================================================================
// UC-31 roles — integration (PRD C31, UC-31 §3, §15 scenarios 83–85).
//
// Enforced on the server, in the service layer: every write a role may not do
// rejects with `WorkspaceForbiddenError`, whatever the UI shows.
// ============================================================================

const reachable = await pingDatabase();
const suite = reachable ? describe : describe.skip;

const ALLOW = parseAllowlist("owner@example.com, reader@example.com, editor@example.com, admin@example.com, admin2@example.com");

interface Fixture {
  owner: WorkspaceAccess;
  reader: WorkspaceAccess;
  editor: WorkspaceAccess;
  admin: WorkspaceAccess;
  workspaceId: string;
  novId: string;
  decId: string;
  foodId: string;
  payId: string;
  committedLineId: string;
  estimatedLineId: string;
  ownerTicketId: string;
  incomeId: string;
  templateId: string;
  annualId: string;
}

async function seedSharedWorkspace(): Promise<Fixture> {
  const ownerPriv = await seedOwnerAccess("r-owner", { email: "owner@example.com" });
  const readerPriv = await seedOwnerAccess("r-reader", { email: "reader@example.com" });
  const editorPriv = await seedOwnerAccess("r-editor", { email: "editor@example.com" });
  const adminPriv = await seedOwnerAccess("r-admin", { email: "admin@example.com" });
  // Signed in once, not a member yet: the target of the "addMember" write.
  await seedOwnerAccess("r-admin2", { email: "admin2@example.com" });
  const ws = await createSharedWorkspace(ownerPriv.userId, { name: "Household", currency: "EUR" });
  const owner = await loadWorkspaceAccess(ownerPriv.userId, ws.id);
  await addMember(owner, { email: "reader@example.com", role: "reader" }, ALLOW);
  await addMember(owner, { email: "editor@example.com", role: "editor" }, ALLOW);
  await addMember(owner, { email: "admin@example.com", role: "admin" }, ALLOW);

  const year = new Date().getFullYear();
  const food = await createCategory(owner, { kind: "expense", name: "Food" });
  const pay = await createCategory(owner, { kind: "income", name: "Salary" });
  const tpl = await createTemplate(owner, { categoryId: food.id, name: "Rent", amount: "800.00", kind: "committed" });
  await createTemplate(owner, { categoryId: food.id, name: "Groceries", amount: "400.00", kind: "estimated" });
  const ann = await createAnnual(owner, { categoryId: food.id, name: "Insurance", chargeMonth: 3, isDirectDebit: false });
  const nov = await createMonth(owner, { year, month: 11 });
  const dec = await createMonth(owner, { year, month: 12 });
  const wsNov = await getMonthWorkspace(owner, year, 11);
  const committed = wsNov.lines.find((l) => l.kind === "committed")!;
  const estimated = wsNov.lines.find((l) => l.kind === "estimated")!;
  const ticket = await addActual(owner, { monthId: nov.id, categoryId: food.id, name: "Owner shop", amount: "10.00" });
  const income = await addIncome(owner, { monthId: nov.id, categoryId: pay.id, name: "Pay", amount: "2000.00" });

  return {
    owner,
    reader: await loadWorkspaceAccess(readerPriv.userId, ws.id),
    editor: await loadWorkspaceAccess(editorPriv.userId, ws.id),
    admin: await loadWorkspaceAccess(adminPriv.userId, ws.id),
    workspaceId: ws.id,
    novId: nov.id,
    decId: dec.id,
    foodId: food.id,
    payId: pay.id,
    committedLineId: committed.id,
    estimatedLineId: estimated.id,
    ownerTicketId: ticket.id,
    incomeId: income.id,
    templateId: tpl.id,
    annualId: ann.id,
  };
}

/** Every write of the matrix except members/workspace management, as thunks. */
function dataWrites(a: WorkspaceAccess, f: Fixture): Record<string, () => Promise<unknown>> {
  const year = new Date().getFullYear();
  return {
    createMonth: () => createMonth(a, { year: year + 1, month: 1 }),
    deleteMonth: () => deleteMonth(a, { monthId: f.decId }),
    createCategory: () => createCategory(a, { kind: "expense", name: `New ${a.role}` }),
    renameCategory: () => renameCategory(a, { id: f.foodId, name: "Groceries2" }),
    deactivateCategory: () => deactivateCategory(a, { id: f.foodId }),
    reactivateCategory: () => reactivateCategory(a, { id: f.foodId }),
    setCategorySavings: () => setCategorySavings(a, { id: f.foodId, countsAsSavings: true }),
    addActual: () => addActual(a, { monthId: f.novId, categoryId: f.foodId, name: "Shop", amount: "5.00" }),
    editOthersActual: () =>
      editActual(a, { id: f.ownerTicketId, categoryId: f.foodId, name: "Edited", amount: "11.00" }),
    deleteOthersActual: () => deleteActual(a, { id: f.ownerTicketId }),
    moveActual: () => moveActualToMonth(a, { actualId: f.ownerTicketId, targetMonthId: f.decId }),
    addIncome: () => addIncome(a, { monthId: f.novId, categoryId: f.payId, name: "Bonus", amount: "1.00" }),
    deleteIncome: () => deleteIncome(a, { id: f.incomeId }),
    addMonthOnlyLine: () =>
      addMonthOnlyLine(a, { monthId: f.novId, categoryId: f.foodId, name: "Gift", amount: "1.00", kind: "estimated" }),
    updateRemaining: () => updateRemainingAmount(a, { lineId: f.estimatedLineId, remainingAmount: "300.00" }),
    deleteLine: () => deleteMonthLine(a, { lineId: f.estimatedLineId }),
    passToActual: () => passToActual(a, { lineId: f.committedLineId }),
    passToUpcoming: () => passToUpcomingMonth(a, { lineId: f.estimatedLineId, targetMonthId: f.decId }),
    applyEstimate: () => applyEstimateSuggestion(a, { monthId: f.novId, categoryId: f.foodId, mode: "suggested" }),
    createTemplate: () =>
      createTemplate(a, { categoryId: f.foodId, name: "Gym", amount: "30.00", kind: "committed" }),
    updateTemplate: () =>
      updateTemplate(a, { id: f.templateId, categoryId: f.foodId, name: "Rent2", amount: "1.00", kind: "committed" }),
    deactivateTemplate: () => deactivateTemplate(a, { id: f.templateId }),
    deleteTemplate: () => deleteTemplate(a, { id: f.templateId }),
    createAnnual: () =>
      createAnnual(a, { categoryId: f.foodId, name: "Tax", chargeMonth: 4, isDirectDebit: false }),
    deactivateAnnual: () => deactivateAnnual(a, { id: f.annualId }),
    renameWorkspace: () => renameWorkspace(a, { name: "Renamed" }),
    setCurrency: () => setWorkspaceCurrency(a, "USD"),
    addMember: () => addMember(a, { email: "admin2@example.com", role: "reader" }, ALLOW),
    deleteWorkspace: () => deleteWorkspace(a, { confirmName: "Household" }),
  };
}

async function readsEverything(a: WorkspaceAccess, f: Fixture): Promise<void> {
  const year = new Date().getFullYear();
  expect((await getMonthList(a)).length).toBe(2);
  expect((await getMonthWorkspace(a, year, 11)).lines.length).toBeGreaterThan(0);
  await getMonthSummary(a, f.novId);
  await getOverspendWarnings(a, f.novId);
  await getEstimateCheck(a, f.novId);
  expect((await listActualsForMonth(a, f.novId)).length).toBeGreaterThan(0);
  expect((await listCategoriesForManagement(a, "expense")).length).toBe(1);
  expect((await listTemplatesForManagement(a, undefined)).length).toBe(2);
  expect((await listAnnualsForManagement(a)).length).toBe(1);
  await getGlobalStatsPage(a, {});
  await searchActuals(a, "shop");
  expect((await resolveExportMonths(a, { mode: "all" })).length).toBe(2);
  expect((await getWorkspaceDetails(a)).members.length).toBe(4);
}

suite("UC-31 roles", () => {
  beforeAll(async () => {
    await truncateAllTenantTables();
  });

  afterEach(async () => {
    await truncateAllTenantTables();
  });

  afterAll(async () => {
    await db.$client.end({ timeout: 1 });
  });

  it("83 — Reader sees every report and screen; every write is rejected by the server", async () => {
    const f = await seedSharedWorkspace();
    await readsEverything(f.reader, f);
    for (const [name, write] of Object.entries(dataWrites(f.reader, f))) {
      await expect(write(), name).rejects.toBeInstanceOf(WorkspaceForbiddenError);
    }
  });

  it("84 — Editor creates a month and a category and adds an actual; everything else is rejected; edits and deletes only own actuals", async () => {
    const f = await seedSharedWorkspace();
    await readsEverything(f.editor, f);
    const writes = dataWrites(f.editor, f);
    const allowed = new Set(["createMonth", "createCategory", "addActual"]);
    for (const [name, write] of Object.entries(writes)) {
      if (allowed.has(name)) {
        await expect(write(), name).resolves.toBeDefined();
      } else {
        await expect(write(), name).rejects.toBeInstanceOf(WorkspaceForbiddenError);
      }
    }

    const own = await addActual(f.editor, { monthId: f.novId, categoryId: f.foodId, name: "Mine", amount: "3.00" });
    expect(own.createdByUserId).toBe(f.editor.userId);
    const edited = await editActual(f.editor, { id: own.id, categoryId: f.foodId, name: "Mine2", amount: "4.00" });
    expect(edited.name).toBe("Mine2");
    await deleteActual(f.editor, { id: own.id });
    // The Owner's ticket is untouched.
    const left = await listActualsForMonth(f.owner, f.novId);
    expect(left.find((t) => t.id === f.ownerTicketId)!.name).toBe("Owner shop");
  });

  it("85 — Admin has full data access except deleting the workspace; manages members but never the Owner", async () => {
    const f = await seedSharedWorkspace();
    await readsEverything(f.admin, f);

    // Data writes that do not destroy fixtures the later ones need.
    const writes = dataWrites(f.admin, f);
    for (const name of [
      "createMonth",
      "createCategory",
      "renameCategory",
      "setCategorySavings",
      "addActual",
      "editOthersActual",
      "addIncome",
      "addMonthOnlyLine",
      "updateRemaining",
      "applyEstimate",
      "createTemplate",
      "updateTemplate",
      "createAnnual",
      "renameWorkspace",
      "setCurrency",
      "addMember",
    ]) {
      await expect(writes[name]!(), name).resolves.toBeDefined();
    }
    const passed = await passToActual(f.admin, { lineId: f.committedLineId });
    await undoPassToActual(f.admin, { actualId: passed.id });
    await moveActualToMonth(f.admin, { actualId: f.ownerTicketId, targetMonthId: f.decId });
    await deleteActual(f.admin, { id: f.ownerTicketId });
    await deleteMonth(f.admin, { monthId: f.decId });

    await expect(writes.deleteWorkspace!()).rejects.toBeInstanceOf(WorkspaceForbiddenError);

    // Members: re-role and remove others (another Admin too), never the Owner.
    const details = await getWorkspaceDetails(f.admin);
    const admin2 = details.members.find((m) => m.email === "admin2@example.com")!;
    await changeMemberRole(f.admin, { userId: admin2.userId, role: "admin" });
    await removeMember(f.admin, { userId: admin2.userId });
    await changeMemberRole(f.admin, { userId: f.reader.userId, role: "editor" });
    await expect(
      changeMemberRole(f.admin, { userId: f.owner.userId, role: "reader" }),
    ).rejects.toBeInstanceOf(CannotRemoveOwnerError);
    await expect(removeMember(f.admin, { userId: f.owner.userId })).rejects.toBeInstanceOf(
      CannotRemoveOwnerError,
    );
  });
});

async function pingDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch (err) {
    process.stderr.write(
      `[integration] Postgres unreachable, skipping UC-31 roles suite: ${(err as Error).message}\n`,
    );
    return false;
  }
}

async function truncateAllTenantTables(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE app_user CASCADE`);
}
