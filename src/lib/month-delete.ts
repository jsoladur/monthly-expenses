// ============================================================================
// UC-27 delete-month confirmation guard.
//
// The user must type the localized month label exactly as the page shows it
// ("November 2026" / "noviembre de 2026"). Comparison is trimmed and
// case-insensitive (locale-aware lower-casing) and collapses inner runs of
// whitespace so a double space does not block the delete. This is a UI guard
// only — the server re-validates month id + ownership.
// ============================================================================

function normalize(value: string, locale: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase(locale);
}

export function matchesMonthLabel(typed: string, label: string, locale: string): boolean {
  const expected = normalize(label, locale);
  return expected.length > 0 && normalize(typed, locale) === expected;
}
