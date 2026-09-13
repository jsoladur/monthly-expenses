// ============================================================================
// Export selection helpers (UC-19, PRD UC-24 / C22).
//
// Pure functions: sort, filename, sheet-name sanitize. No I/O.
// ============================================================================

export type ExportPeriod = {
  year: number;
  month: number;
};

export type ExportSelection =
  | { mode: "all" }
  | { mode: "year"; years: number[] }
  | { mode: "months"; periods: ExportPeriod[] };

export function comparePeriodsDescending(a: ExportPeriod, b: ExportPeriod): number {
  return b.year - a.year || b.month - a.month;
}

export function sortPeriodsDescending(
  periods: readonly ExportPeriod[],
): ExportPeriod[] {
  return [...periods].sort(comparePeriodsDescending);
}

export function dedupeYearsDescending(years: readonly number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const year of [...years].sort((a, b) => b - a)) {
    if (seen.has(year)) continue;
    seen.add(year);
    out.push(year);
  }
  return out;
}

export function uniqueYearsDescending(periods: readonly ExportPeriod[]): number[] {
  const seen = new Set<number>();
  const years: number[] = [];
  for (const period of sortPeriodsDescending(periods)) {
    if (seen.has(period.year)) continue;
    seen.add(period.year);
    years.push(period.year);
  }
  return years;
}

export function padMonth(month: number): string {
  return String(month).padStart(2, "0");
}

export function dedupePeriods(periods: readonly ExportPeriod[]): ExportPeriod[] {
  const seen = new Set<string>();
  const out: ExportPeriod[] = [];
  for (const period of periods) {
    const key = `${period.year}-${period.month}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(period);
  }
  return sortPeriodsDescending(out);
}

export function exportFilename(selection: ExportSelection): string {
  if (selection.mode === "all") return "monthly-expenses-all.xlsx";
  if (selection.mode === "year") {
    const years = dedupeYearsDescending(selection.years);
    if (years.length === 1) return `monthly-expenses-${years[0]}.xlsx`;
    return "monthly-expenses-selected.xlsx";
  }
  const unique = dedupePeriods(selection.periods);
  if (unique.length === 1) {
    const period = unique[0]!;
    return `monthly-expenses-${period.year}-${padMonth(period.month)}.xlsx`;
  }
  return "monthly-expenses-selected.xlsx";
}

const FORBIDDEN_SHEET_CHARS = /[\\/?*[\]:]/g;

export function sanitizeSheetName(
  year: number,
  month: number,
  monthLabel: string,
): string {
  const prefix = `${year}-${padMonth(month)}`;
  const cleaned = monthLabel
    .replace(FORBIDDEN_SHEET_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim();
  const raw = cleaned.length > 0 ? `${prefix} ${cleaned}` : prefix;
  if (raw.length <= 31) return raw;
  return raw.slice(0, 31).trimEnd();
}
