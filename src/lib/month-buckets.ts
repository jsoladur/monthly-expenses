// ============================================================================
// Home vs History split (PRD UC-14).
//
// Home lists every month of the current calendar year AND of any later year
// (e.g. January of next year created ahead of time). History lists only the
// years before the current one. Every year lands in exactly one of the two.
// Pure functions so unit tests do not need Postgres or a browser.
// ============================================================================

export function isHomeYear(year: number, now: Date = new Date()): boolean {
  return year >= now.getFullYear();
}

export function isHistoryYear(year: number, now: Date = new Date()): boolean {
  return !isHomeYear(year, now);
}
