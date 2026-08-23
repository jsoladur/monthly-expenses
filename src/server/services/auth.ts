import "server-only";
import { db } from "@/server/db/client";
import { profileSettings } from "@/server/db/schema";
import {
  findUserByGoogleSub,
  insertUser,
  type Tx,
} from "@/server/repositories/user";
import { insertProfileSettings } from "@/server/repositories/profile-settings";
import type { AppUser } from "@/server/db/schema";

// ============================================================================
// Auth service — first sign-in provisioning (UC-01, ARCH §3.1).
//
// Runs ONLY inside the `signIn` callback after the ALLOWED_EMAILS check has
// already passed (PRD C3, ARCH §3.2 rule 2). It is the single place where an
// `app_user` row may be created; nothing else writes to the table.
//
// First-time sign-in: insert `app_user` + `profile_settings(currency='EUR')`
// in one transaction so the tenant either gets both rows or neither
// (PRD §5.3, ARCH §3.1). Repeat sign-in: return the existing user as-is.
//
// Returns the internal `app_user.id` that the JWT callback will place in
// `token.userId` (ARCH §3.2 rule 3).
// ============================================================================

export interface GoogleIdentity {
  googleSub: string;
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export async function upsertUserOnSignIn(identity: GoogleIdentity): Promise<AppUser> {
  const existing = await findUserByGoogleSub(identity.googleSub);
  if (existing) {
    return existing;
  }

  return db.transaction(async (tx: Tx) => {
    const created = await insertUser(
      {
        googleSub: identity.googleSub,
        email: identity.email,
        displayName: identity.displayName ?? null,
        avatarUrl: identity.avatarUrl ?? null,
      },
      tx,
    );
    await insertProfileSettings({ userId: created.id, currency: "EUR" }, tx);
    return created;
  });
}

// Re-export so tests don't need a second import to reach the schema.
export { profileSettings };
