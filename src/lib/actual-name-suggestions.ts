import { foldAccents } from "@/server/search/sanitize";

// ============================================================================
// Actual name autocomplete helpers (UC-17, PRD UC-22 / C13).
//
// Pure functions shared by the RSC service (window) and the client combobox
// (prefix filter). Accent-folding reuses Search's `foldAccents` so `Café`
// matches `ca` the same way Search matches it.
// ============================================================================

export const ACTUAL_NAME_WINDOW_BACK = 2;
export const ACTUAL_NAME_SUGGESTION_LIMIT = 5;
export const ACTUAL_NAME_CORPUS_LIMIT = 200;
export const ACTUAL_NAME_MIN_CHARS = 2;

export type ActualNameSuggestion = {
  name: string;
  year: number;
  month: number;
};

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
  corpus: ActualNameSuggestion[],
  rawQuery: string,
  limit: number = ACTUAL_NAME_SUGGESTION_LIMIT,
): ActualNameSuggestion[] {
  const prefix = foldAccents(rawQuery).trim();
  if (prefix.length < ACTUAL_NAME_MIN_CHARS) return [];
  const matches: ActualNameSuggestion[] = [];
  for (const item of corpus) {
    const folded = foldAccents(item.name);
    if (folded === prefix) continue;
    if (!folded.startsWith(prefix)) continue;
    matches.push(item);
    if (matches.length >= limit) break;
  }
  return matches;
}
