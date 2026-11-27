// ============================================================================
// Workspace name helpers (UC-31 §4.2, §4.6) — pure, shared by the service and
// the delete confirmation UI.
// ============================================================================

export const WORKSPACE_NAME_MAX = 60;

/** Currencies offered by the pickers (label only, no FX — PRD C9). */
export const SUPPORTED_CURRENCIES = ["EUR", "USD", "GBP", "JPY", "CHF", "CAD", "AUD", "MXN", "ARS"] as const;

/** Typed-name guard: trimmed, inner spaces collapsed, case-insensitive (same pattern as C27). */
export function matchesWorkspaceName(typed: string, name: string): boolean {
  const fold = (s: string) => s.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return fold(typed).length > 0 && fold(typed) === fold(name);
}
