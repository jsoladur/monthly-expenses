// ============================================================================
// Pass-to-upcoming-month helpers (UC-18, PRD UC-23 / C21).
//
// Pure functions so unit tests do not need Postgres. The service reuses
// these gates before it opens a transaction.
// ============================================================================

export function isUpcomingMonthInSameYear(
  source: { year: number; month: number },
  target: { year: number; month: number },
): boolean {
  return target.year === source.year && target.month > source.month;
}

export function isPassToUpcomingAllowedYear(
  sourceYear: number,
  now: Date = new Date(),
): boolean {
  return sourceYear === now.getFullYear();
}
