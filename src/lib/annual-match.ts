import { foldAccents } from "@/server/search/sanitize";

// ============================================================================
// Annual reminder "already added" match (UC-28, proposed PRD UC-30 / C28).
//
// Pure: the service feeds it the open month's reserved lines and actuals and
// it answers, per annual, "does this month already hold a line for it?".
// Nothing is stored — a hard-deleted line simply stops matching on the next
// render (§6.8: no row references an annual).
//
// A candidate matches when it shares the annual's category AND its folded
// name equals, or starts with, the annual's folded name. Folding reuses the
// UC-16/UC-17 accent + case fold, plus whitespace collapse.
// ============================================================================

export type AnnualMatchSource = "reserved" | "actual";

export interface AnnualMatchCandidate {
  source: AnnualMatchSource;
  categoryId: string;
  name: string;
  amountCents: number;
}

export interface AnnualMatch {
  source: AnnualMatchSource;
  name: string;
  amountCents: number;
}

export function foldAnnualName(raw: string): string {
  return foldAccents(raw).trim().replace(/\s+/g, " ");
}

const SOURCE_RANK: Record<AnnualMatchSource, number> = { reserved: 0, actual: 1 };

/**
 * First match wins: reserved lines before actuals, then by name.
 */
export function findAnnualMatch(
  annual: { categoryId: string; name: string },
  candidates: readonly AnnualMatchCandidate[],
): AnnualMatch | null {
  const target = foldAnnualName(annual.name);
  if (target.length === 0) return null;

  let best: AnnualMatchCandidate | null = null;
  for (const c of candidates) {
    if (c.categoryId !== annual.categoryId) continue;
    if (!foldAnnualName(c.name).startsWith(target)) continue;
    if (best === null || compareCandidates(c, best) < 0) best = c;
  }
  return best === null
    ? null
    : { source: best.source, name: best.name, amountCents: best.amountCents };
}

function compareCandidates(a: AnnualMatchCandidate, b: AnnualMatchCandidate): number {
  const bySource = SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
  if (bySource !== 0) return bySource;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}
