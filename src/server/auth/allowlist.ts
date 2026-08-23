// ============================================================================
// Email allowlist (PRD C2 / §5.2, ARCH §3.2 rule 1).
//
// Source: `ALLOWED_EMAILS` env var (comma-separated). Emails are normalized
// (trim + lowercase) on both write and read so casing and stray whitespace
// never cause false denials. Denied users get NO session and NO database rows
// (PRD C3 / ARCH §3.2 rule 2) — the `signIn` callback returns `false` and
// the user lands on the i18n 403 page.
//
// Pure functions: no I/O, no globals. Tested in `tests/unit/allowlist.test.ts`.
// ============================================================================

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function parseAllowlist(raw: string | undefined | null): ReadonlySet<string> {
  if (!raw) {
    return new Set();
  }
  const set = new Set<string>();
  for (const part of raw.split(",")) {
    const normalized = normalizeEmail(part);
    if (normalized.length > 0) {
      set.add(normalized);
    }
  }
  return set;
}

export function isAllowlisted(
  email: string | null | undefined,
  allowlist: ReadonlySet<string>,
): boolean {
  if (!email) {
    return false;
  }
  return allowlist.has(normalizeEmail(email));
}
