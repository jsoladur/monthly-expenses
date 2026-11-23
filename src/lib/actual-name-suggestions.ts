import { foldAccents } from "@/server/search/sanitize";

// ============================================================================
// Name autocomplete helpers (UC-17 actuals, UC-30 incomes; PRD UC-22 /
// UC-32 / C13).
//
// Pure functions shared by the repositories (unique corpus), the RSC
// services (window) and the client combobox (prefix filter). Accent-folding reuses Search's `foldAccents` so `Café`
// matches `ca` the same way Search matches it.
// ============================================================================

export const ACTUAL_NAME_WINDOW_BACK = 2;
export const ACTUAL_NAME_SUGGESTION_LIMIT = 5;
export const ACTUAL_NAME_CORPUS_LIMIT = 200;
export const ACTUAL_NAME_MIN_CHARS = 2;

export type NameSuggestion = {
  name: string;
  year: number;
  month: number;
};

/** @deprecated kept for UC-17 call sites; same shape as `NameSuggestion`. */
export type ActualNameSuggestion = NameSuggestion;

/**
 * Collapse newest-first rows to one entry per folded name (newest spelling
 * wins) and cap the corpus. Applied in the repositories instead of
 * `DISTINCT ON` (see `listRecentActualNames`).
 */
export function uniqueRecentNames(
  rows: Iterable<{ name: string; year: number | string; month: number | string }>,
  limit: number = ACTUAL_NAME_CORPUS_LIMIT,
): NameSuggestion[] {
  const seen = new Set<string>();
  const unique: NameSuggestion[] = [];
  for (const row of rows) {
    const key = foldAccents(row.name);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ name: row.name, year: Number(row.year), month: Number(row.month) });
    if (unique.length >= limit) break;
  }
  return unique;
}

export function recentMonthWindow(
  year: number,
  month: number,
  back: number = ACTUAL_NAME_WINDOW_BACK,
): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  let y = year;
  let m = month;
  for (let i = 0; i <= back; i++) {
    out.push({ year: y, month: m });
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

export function filterNameSuggestions(
  corpus: NameSuggestion[],
  rawQuery: string,
  limit: number = ACTUAL_NAME_SUGGESTION_LIMIT,
): NameSuggestion[] {
  const prefix = foldAccents(rawQuery).trim();
  if (prefix.length < ACTUAL_NAME_MIN_CHARS) return [];
  const matches: NameSuggestion[] = [];
  for (const item of corpus) {
    const folded = foldAccents(item.name);
    if (folded === prefix) continue;
    if (!folded.startsWith(prefix)) continue;
    matches.push(item);
    if (matches.length >= limit) break;
  }
  return matches;
}
