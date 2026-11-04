// ============================================================================
// Estimate check — pure reconciliation math (UC-25, proposed PRD C25).
//
// Per expense category with at least one `estimated` line:
//   plan      = Σ original_amount of its estimated lines
//   remaining = Σ remaining_amount of its estimated lines
//   tickets   = Σ actual amounts in the category, EXCLUDING tickets created
//               by pass-to-actual (that move deletes the source line, so its
//               amount already left `plan` — counting the ticket too would
//               flag every passed line as a false overlap)
//   suggested = max(plan − tickets, 0)
//   flagged   = remaining > suggested
//
// Everything is integer cents (ADR-5, ARCH §8). Negatives follow the
// algebra (PRD §7.6); only `suggested` is clamped at 0. No I/O here so the
// service and the UI share one definition and unit tests cover it fully.
//
// A ticket has no link to the envelope it was paid from, so a flag is a
// HINT ("possible overlap"), never a verdict: an unplanned ticket in the
// same category legitimately leaves the envelope untouched. The UI lists
// the tickets so the user decides.
// ============================================================================

export type EstimateCheckMode = "suggested" | "release";

export interface EstimateLineInput {
  id: string;
  categoryId: string;
  categoryName: string;
  name: string;
  originalCents: number;
  remainingCents: number;
}

export interface TicketInput {
  id: string;
  categoryId: string;
  name: string;
  amountCents: number;
  /** Created by pass-to-actual (`converted_from_line_id` set). */
  fromLine: boolean;
}

export interface EstimateCheckTicket {
  id: string;
  name: string;
  amount: number;
  /** false → passed from a fixed line; shown but not counted. */
  counted: boolean;
}

export interface EstimateCheckLine {
  id: string;
  name: string;
  remaining: number;
}

export interface EstimateCheckCategory {
  categoryId: string;
  categoryName: string;
  plan: number;
  remaining: number;
  tickets: number;
  suggested: number;
  flagged: boolean;
  lines: EstimateCheckLine[];
  ticketList: EstimateCheckTicket[];
}

export interface EstimateCheck {
  categories: EstimateCheckCategory[];
  /** Σ (remaining − suggested) over flagged categories. */
  releasableTotal: number;
}

export function compareLineNames(a: { name: string; id: string }, b: { name: string; id: string }): number {
  const byName = a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  if (byName !== 0) return byName;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function computeEstimateCheck(
  lines: ReadonlyArray<EstimateLineInput>,
  tickets: ReadonlyArray<TicketInput>,
): EstimateCheck {
  const ticketsByCategory = new Map<string, EstimateCheckTicket[]>();
  for (const row of tickets) {
    const ticket: EstimateCheckTicket = {
      id: row.id,
      name: row.name,
      amount: row.amountCents,
      counted: !row.fromLine,
    };
    const bucket = ticketsByCategory.get(row.categoryId);
    if (bucket) bucket.push(ticket);
    else ticketsByCategory.set(row.categoryId, [ticket]);
  }

  const grouped = new Map<string, EstimateLineInput[]>();
  for (const line of lines) {
    const bucket = grouped.get(line.categoryId);
    if (bucket) bucket.push(line);
    else grouped.set(line.categoryId, [line]);
  }

  const categories: EstimateCheckCategory[] = [];
  for (const [categoryId, bucket] of grouped) {
    const sorted = [...bucket].sort(compareLineNames);
    const plan = sorted.reduce((acc, l) => acc + l.originalCents, 0);
    const remaining = sorted.reduce((acc, l) => acc + l.remainingCents, 0);
    const ticketList = [...(ticketsByCategory.get(categoryId) ?? [])].sort(
      (a, b) => Number(b.counted) - Number(a.counted) || b.amount - a.amount,
    );
    const spent = ticketList.filter((t) => t.counted).reduce((acc, t) => acc + t.amount, 0);
    const suggested = Math.max(plan - spent, 0);
    categories.push({
      categoryId,
      categoryName: sorted[0]!.categoryName,
      plan,
      remaining,
      tickets: spent,
      suggested,
      flagged: remaining > suggested,
      lines: sorted.map((l) => ({ id: l.id, name: l.name, remaining: l.remainingCents })),
      ticketList,
    });
  }

  categories.sort((a, b) => {
    if (a.flagged !== b.flagged) return a.flagged ? -1 : 1;
    return a.categoryName.localeCompare(b.categoryName, "en", { sensitivity: "base" });
  });

  const releasableTotal = categories
    .filter((c) => c.flagged)
    .reduce((acc, c) => acc + (c.remaining - c.suggested), 0);

  return { categories, releasableTotal };
}

/**
 * New remaining per line for a category, in `name` order.
 * - `suggested`: each line keeps `min(its remaining, what is left of
 *   suggested)`; later lines go to 0.
 * - `release`: every line goes to 0.
 * Only lines whose value changes are returned.
 */
export function planEstimateUpdates(
  category: Pick<EstimateCheckCategory, "suggested" | "lines">,
  mode: EstimateCheckMode,
): Array<{ id: string; remaining: number }> {
  const sorted = [...category.lines].sort(compareLineNames);
  const updates: Array<{ id: string; remaining: number }> = [];
  let left = category.suggested;
  for (const line of sorted) {
    const keep = mode === "release" ? 0 : Math.min(line.remaining, Math.max(left, 0));
    left -= keep;
    if (keep !== line.remaining) updates.push({ id: line.id, remaining: keep });
  }
  return updates;
}

/** Strictly before the current calendar month (UTC) — PRD §7.7. */
export function isBeforeCurrentMonth(year: number, month: number, now: Date): boolean {
  return year * 12 + month < now.getUTCFullYear() * 12 + (now.getUTCMonth() + 1);
}
