import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  template,
  type LineKind,
  type NewTemplate,
  type Template,
} from "@/server/db/schema";
import type { Tx } from "@/server/repositories/user";

// ============================================================================
// Template repository (UC-05, PRD §6.3 / §7.4, ARCH §4).
//
// The clone source for `month_fixed_line` and the overspend baseline for the
// summary (PRD §7.4). Every function takes `userId` as its FIRST argument
// and applies it in every WHERE clause (PRD §5.1, ARCH §5 rule 1).
//
// `template.active` is the soft-delete flag — inactive rows are EXCLUDED from
// `listActiveTemplates*` (the clone source), and INCLUDED in
// `listTemplatesForManagement` (so the user can scan history and reactivate).
// `template.months` is the month schedule (UC-20): NULL = every month.
// `template.end_year` / `end_month` is the last payment month of a committed
// template (UC-29): month creation clones from `listTemplatesToClone` and
// then calls `deactivateEndedTemplates`.
//
// `Tx` is the Drizzle transaction handle; repository functions accept it so
// the service layer can compose them inside a transaction when needed
// (ARCH §5 rule: services own transactions).
// ============================================================================

export async function listTemplates(
  userId: string,
  { includeInactive }: { includeInactive?: boolean } = {},
  tx: Tx | typeof db = db,
): Promise<Template[]> {
  const where = includeInactive
    ? eq(template.userId, userId)
    : and(eq(template.userId, userId), eq(template.active, true));
  return tx
    .select()
    .from(template)
    .where(where)
    .orderBy(asc(template.kind), asc(template.createdAt));
}

export async function listTemplatesByKind(
  userId: string,
  kind: LineKind,
  { includeInactive }: { includeInactive?: boolean } = {},
  tx: Tx | typeof db = db,
): Promise<Template[]> {
  const where = includeInactive
    ? and(eq(template.userId, userId), eq(template.kind, kind))
    : and(
        eq(template.userId, userId),
        eq(template.kind, kind),
        eq(template.active, true),
      );
  return tx
    .select()
    .from(template)
    .where(where)
    .orderBy(asc(template.createdAt));
}

export async function listActiveTemplates(
  userId: string,
  tx: Tx | typeof db = db,
): Promise<Template[]> {
  return listTemplates(userId, { includeInactive: false }, tx);
}

export async function listActiveTemplatesByKind(
  userId: string,
  kind: LineKind,
  tx: Tx | typeof db = db,
): Promise<Template[]> {
  return listTemplatesByKind(userId, kind, { includeInactive: false }, tx);
}

// Months compare by `year * 12 + (month − 1)` (UC-26 / UC-29).
const endIndex = sql`(${template.endYear}::int * 12 + ${template.endMonth}::int - 1)`;

function periodIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

function scheduleApplies(month: number) {
  return sql`(${template.months} IS NULL OR ${month}::smallint = ANY(${template.months}))`;
}

// Clone source for the month `year`/`month` being created (PRD C17 / C23 /
// C29): ACTIVE templates whose schedule is NULL (every month) or contains
// `month`, and whose last payment month — if any — is not before it.
export async function listTemplatesToClone(
  userId: string,
  year: number,
  month: number,
  tx: Tx | typeof db = db,
): Promise<Template[]> {
  return tx
    .select()
    .from(template)
    .where(
      and(
        eq(template.userId, userId),
        eq(template.active, true),
        scheduleApplies(month),
        sql`(${template.endYear} IS NULL OR ${endIndex} >= ${periodIndex(year, month)})`,
      ),
    )
    .orderBy(asc(template.kind), asc(template.createdAt));
}

// Overspend baseline for the open month (PRD §7.4 as amended by C29): the
// templates that apply to its month-number and are either active without a
// last payment month, or have a last payment month that is not before the
// open month — active or already deactivated. The second branch keeps an
// ended loan in the plan of the months it was really paid in.
export async function listPlanTemplatesForMonth(
  userId: string,
  year: number,
  month: number,
  tx: Tx | typeof db = db,
): Promise<Template[]> {
  return tx
    .select()
    .from(template)
    .where(
      and(
        eq(template.userId, userId),
        scheduleApplies(month),
        sql`((${template.endYear} IS NULL AND ${template.active} = true) OR (${template.endYear} IS NOT NULL AND ${endIndex} >= ${periodIndex(year, month)}))`,
      ),
    )
    .orderBy(asc(template.kind), asc(template.createdAt));
}

// Soft-deactivates every ACTIVE template of the user whose last payment month
// is `year`/`month` or earlier (PRD C29, UC-29). Called by `createMonth`
// right after the clone, in the same transaction. Never deletes.
export async function deactivateEndedTemplates(
  userId: string,
  year: number,
  month: number,
  tx: Tx | typeof db = db,
): Promise<Template[]> {
  return tx
    .update(template)
    .set({ active: false, deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(template.userId, userId),
        eq(template.active, true),
        sql`${template.endYear} IS NOT NULL`,
        sql`${endIndex} <= ${periodIndex(year, month)}`,
      ),
    )
    .returning();
}

export async function findTemplateById(
  userId: string,
  id: string,
  tx: Tx | typeof db = db,
): Promise<Template | null> {
  const rows = await tx
    .select()
    .from(template)
    .where(and(eq(template.userId, userId), eq(template.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertTemplate(
  row: NewTemplate,
  tx: Tx | typeof db = db,
): Promise<Template> {
  const [created] = await tx.insert(template).values(row).returning();
  if (!created) {
    throw new Error("insertTemplate returned no rows");
  }
  return created;
}

export async function updateTemplate(
  userId: string,
  id: string,
  patch: {
    categoryId: string;
    name: string;
    observations: string | null;
    amount: string;
    kind: LineKind;
    months: number[] | null;
    endYear: number | null;
    endMonth: number | null;
  },
  tx: Tx | typeof db = db,
): Promise<Template | null> {
  const [updated] = await tx
    .update(template)
    .set({
      categoryId: patch.categoryId,
      name: patch.name,
      observations: patch.observations,
      amount: patch.amount,
      kind: patch.kind,
      months: patch.months,
      endYear: patch.endYear,
      endMonth: patch.endMonth,
      updatedAt: sql`now()`,
    })
    .where(and(eq(template.userId, userId), eq(template.id, id)))
    .returning();
  return updated ?? null;
}

export async function deactivateTemplate(
  userId: string,
  id: string,
  tx: Tx | typeof db = db,
): Promise<Template | null> {
  // Guard clause on `active = true` so a double-deactivate is a no-op rather
  // than overwriting the original `deletedAt`. The service translates the
  // `null` return into `TemplateAlreadyInactiveError`.
  const [updated] = await tx
    .update(template)
    .set({ active: false, deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(template.userId, userId),
        eq(template.id, id),
        eq(template.active, true),
      ),
    )
    .returning();
  return updated ?? null;
}

// Reactivating also clears the last payment month (PRD C29, UC-29): otherwise
// an ended loan would be deactivated again by the next created month.
export async function reactivateTemplate(
  userId: string,
  id: string,
  tx: Tx | typeof db = db,
): Promise<Template | null> {
  const [updated] = await tx
    .update(template)
    .set({
      active: true,
      deletedAt: null,
      endYear: null,
      endMonth: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(template.userId, userId),
        eq(template.id, id),
        eq(template.active, false),
      ),
    )
    .returning();
  return updated ?? null;
}

// HARD delete (PRD C23 / §13, UC-20). Safe because no FK references
// `template` — month lines are snapshots copied at clone time.
export async function deleteTemplate(
  userId: string,
  id: string,
  tx: Tx | typeof db = db,
): Promise<Template | null> {
  const [deleted] = await tx
    .delete(template)
    .where(and(eq(template.userId, userId), eq(template.id, id)))
    .returning();
  return deleted ?? null;
}
