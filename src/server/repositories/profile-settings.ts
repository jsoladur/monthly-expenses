import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  profileSettings,
  type NewProfileSettings,
  type ProfileSettings,
} from "@/server/db/schema";
import type { Tx } from "@/server/repositories/user";

// ============================================================================
// Profile settings repository (PRD §5.3, ARCH §4).
//
// 1:1 with `app_user`. Every function takes `userId` first (PRD §5.1,
// ARCH §5 rule 1). The default currency is EUR — the schema default mirrors
// the spec (UC-01 / PRD §5.3). Optional transaction handle so the first-sign-in
// provisioning can insert user + profile_settings atomically (PRD §5.3).
// ============================================================================

export async function getProfileSettings(
  userId: string,
  tx: Tx | typeof db = db,
): Promise<ProfileSettings | null> {
  const rows = await tx
    .select()
    .from(profileSettings)
    .where(eq(profileSettings.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertProfileSettings(
  row: NewProfileSettings,
  tx: Tx | typeof db = db,
): Promise<ProfileSettings> {
  const [created] = await tx.insert(profileSettings).values(row).returning();
  if (!created) {
    throw new Error("insertProfileSettings returned no rows");
  }
  return created;
}
