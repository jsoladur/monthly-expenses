import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { appUser, profileSettings } from "@/server/db/schema";
import {
  getProfileSettings as repoGet,
  updateCurrency as repoUpdateCurrency,
  updateTheme as repoUpdateTheme,
} from "@/server/repositories/profile-settings";
import type { ProfileSettings, ThemePreference } from "@/server/db/schema";
import type { Tx } from "@/server/repositories/user";

// ============================================================================
// Settings service (UC-04, PRD §5.3 / §7.6 / UC-15, ARCH §5 rule 3).
//
// Owns the domain rules for `profile_settings`. Today the only rule is
// "the currency is a 3-letter ISO 4217 code" — anything else throws
// `InvalidCurrencyError`. There is no FX conversion anywhere: the service
// only writes the label; stored amounts on `month_*` tables stay untouched
// (PRD UC-15).
//
// `getProfileSettings` is the app-wide read used by every screen that
// needs to render amounts (later slices — UC-06 month workspace, UC-07
// incomes, UC-08 actuals, UC-11 summary). It returns `null` when the row
// does not exist (which should only happen if UC-01 hasn't provisioned
// yet — defensive code at the call site decides whether that's a 500 or a
// hard-fail boot screen).
//
// `updateCurrency` validates the code shape, checks the tenant actually
// has a profile row (defensive — `profile_settings` is 1:1 with `app_user`
// so the row must exist), and writes only the label.
// ============================================================================

export class InvalidCurrencyError extends Error {
  readonly code = "invalid_currency" as const;
  constructor(received: unknown) {
    super(`Invalid currency code: ${JSON.stringify(received)} (expected ISO 4217 alpha-3)`);
    this.name = "InvalidCurrencyError";
  }
}

export class ProfileSettingsNotFoundError extends Error {
  readonly code = "profile_settings_not_found" as const;
  constructor(userId: string) {
    super(`Profile settings row missing for user ${userId}`);
    this.name = "ProfileSettingsNotFoundError";
  }
}

const CURRENCY_RE = /^[A-Z]{3}$/;

function assertCurrency(code: unknown): asserts code is string {
  if (typeof code !== "string" || !CURRENCY_RE.test(code)) {
    throw new InvalidCurrencyError(code);
  }
}

// ----------------------------------------------------------------------------
// Reads
// ----------------------------------------------------------------------------

export async function getProfileSettings(
  userId: string,
  tx: Tx | typeof db = db,
): Promise<ProfileSettings | null> {
  return repoGet(userId, tx);
}

// ----------------------------------------------------------------------------
// Mutations
// ----------------------------------------------------------------------------

export async function updateCurrency(
  userId: string,
  currency: string,
  tx: Tx | typeof db = db,
): Promise<ProfileSettings> {
  assertCurrency(currency);
  // Defense in depth: a tenant without an `app_user` row has no profile
  // either (UC-01 provisions both in one transaction). We still verify
  // because a missing profile would otherwise silently swallow the write.
  const tenantExists = await tx
    .select({ id: appUser.id })
    .from(appUser)
    .where(eq(appUser.id, userId))
    .limit(1);
  if (tenantExists.length === 0) {
    throw new ProfileSettingsNotFoundError(userId);
  }
  const updated = await repoUpdateCurrency(userId, currency, tx);
  if (!updated) {
    // The repo WHERE filters on `user_id`; a null return means the row
    // disappeared between the tenant check and the update — treat as
    // not-found so the caller surfaces a clear error rather than a 500.
    throw new ProfileSettingsNotFoundError(userId);
  }
  return updated;
}

// Re-export so tests don't need a second import to reach the schema.
export { profileSettings };

export class InvalidThemeError extends Error {
  readonly code = "invalid_theme" as const;
  constructor(received: unknown) {
    super(`Invalid theme preference: ${JSON.stringify(received)} (expected auto, light, or dark)`);
    this.name = "InvalidThemeError";
  }
}

const VALID_THEMES: ReadonlySet<ThemePreference> = new Set(["auto", "light", "dark"]);

function assertTheme(theme: unknown): asserts theme is ThemePreference {
  if (typeof theme !== "string" || !VALID_THEMES.has(theme as ThemePreference)) {
    throw new InvalidThemeError(theme);
  }
}

export async function updateTheme(
  userId: string,
  theme: string,
  tx: Tx | typeof db = db,
): Promise<ProfileSettings> {
  assertTheme(theme);
  const tenantExists = await tx
    .select({ id: appUser.id })
    .from(appUser)
    .where(eq(appUser.id, userId))
    .limit(1);
  if (tenantExists.length === 0) {
    throw new ProfileSettingsNotFoundError(userId);
  }
  const updated = await repoUpdateTheme(userId, theme, tx);
  if (!updated) {
    throw new ProfileSettingsNotFoundError(userId);
  }
  return updated;
}
