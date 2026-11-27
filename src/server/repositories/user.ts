import "server-only";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { appUser, type AppUser, type NewAppUser } from "@/server/db/schema";

// ============================================================================
// User repository (PRD §5.1, ARCH §5 rule 1).
//
// Every function takes `userId` as its FIRST argument and applies it in every
// WHERE clause. A missing `user_id` filter is a P0 bug (PRD §5.1) and TypeScript
// is the first line of defence: callers cannot invoke these functions without
// supplying a tenant id.
//
// `app_user` is the tenants table; it is named so because `user` is reserved in
// PostgreSQL. Rows are created ONLY by the auth service after the
// `ALLOWED_EMAILS` allowlist check passes (PRD C3, ARCH §3.2 rule 2).
//
// `Tx` is the drizzle transaction handle shape — it shares the query builder
// interface with `db` so repository functions can be called either outside or
// inside a transaction (ARCH §5 rule: services own transactions).
// ============================================================================

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function findUserById(
  userId: string,
  tx: Tx | typeof db = db,
): Promise<AppUser | null> {
  const rows = await tx
    .select()
    .from(appUser)
    .where(eq(appUser.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function findUserByGoogleSub(
  googleSub: string,
  tx: Tx | typeof db = db,
): Promise<AppUser | null> {
  const rows = await tx
    .select()
    .from(appUser)
    .where(eq(appUser.googleSub, googleSub))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertUser(
  row: NewAppUser,
  tx: Tx | typeof db = db,
): Promise<AppUser> {
  const [created] = await tx.insert(appUser).values(row).returning();
  if (!created) {
    throw new Error("insertUser returned no rows");
  }
  return created;
}

export async function upsertUser(
  row: NewAppUser,
  tx: Tx | typeof db = db,
): Promise<AppUser | null> {
  const [inserted] = await tx
    .insert(appUser)
    .values(row)
    .onConflictDoNothing({ target: appUser.googleSub })
    .returning();

  if (!inserted) {
    return null;
  }
  return inserted;
}

/**
 * UC-31 §4.3: find a signed-in user by an allowlist-normalized email (trim +
 * lowercase on both sides). Oldest row first if two Google accounts share one.
 */
export async function findUserByNormalizedEmail(
  normalizedEmail: string,
  tx: Tx | typeof db = db,
): Promise<AppUser | null> {
  const rows = await tx
    .select()
    .from(appUser)
    .where(sql`lower(trim(${appUser.email})) = ${normalizedEmail}`)
    .orderBy(asc(appUser.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/** UC-31 add-member picker: signed-in users among these normalized emails. */
export async function findUsersByNormalizedEmails(
  normalizedEmails: readonly string[],
  tx: Tx | typeof db = db,
): Promise<AppUser[]> {
  if (normalizedEmails.length === 0) return [];
  return tx
    .select()
    .from(appUser)
    .where(inArray(sql`lower(trim(${appUser.email}))`, [...normalizedEmails]))
    .orderBy(asc(appUser.createdAt));
}
