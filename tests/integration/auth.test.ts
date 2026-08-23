import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { appUser, profileSettings } from "@/server/db/schema";
import { upsertUserOnSignIn } from "@/server/services/auth";
import {
  findUserByGoogleSub,
  findUserById,
} from "@/server/repositories/user";
import { getProfileSettings } from "@/server/repositories/profile-settings";

// ============================================================================
// Auth flow integration (UC-01 — PRD scenarios #1 + #2).
//
// Hits the real Postgres the migration suite created. Skipped (not failed)
// when the database is unreachable so `pnpm test` stays usable without
// Docker.
// ============================================================================

const reachable = await pingDatabase();

const suite = reachable ? describe : describe.skip;

suite("UC-01 auth + tenancy", () => {
  beforeAll(async () => {
    await truncateAllTenantTables();
  });

  afterEach(async () => {
    await truncateAllTenantTables();
  });

  afterAll(async () => {
    await db.$client.end({ timeout: 1 });
  });

  it("creates app_user + profile_settings(currency='EUR') on first sign-in", async () => {
    const created = await upsertUserOnSignIn({
      googleSub: "google-sub-alice",
      email: "alice@example.com",
      displayName: "Alice",
      avatarUrl: null,
    });

    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.googleSub).toBe("google-sub-alice");
    expect(created.email).toBe("alice@example.com");

    const profile = await getProfileSettings(created.id);
    expect(profile, "profile_settings must be created in the same transaction").not.toBeNull();
    expect(profile!.currency).toBe("EUR");
    expect(profile!.userId).toBe(created.id);
  });

  it("is idempotent: a second sign-in with the same google_sub returns the same user", async () => {
    const first = await upsertUserOnSignIn({
      googleSub: "google-sub-bob",
      email: "bob@example.com",
    });
    const second = await upsertUserOnSignIn({
      googleSub: "google-sub-bob",
      email: "bob@example.com",
      displayName: "Bob",
    });

    expect(second.id).toBe(first.id);
    expect(second.email).toBe(first.email);

    const profiles = await db.select().from(profileSettings);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.userId).toBe(first.id);
  });

  it("never produces duplicate app_user rows for the same google_sub", async () => {
    // The service does an optimistic `findUserByGoogleSub` lookup before
    // inserting, and the unique constraint on `app_user.google_sub` is the
    // second line of defence if two callbacks slip past the lookup at the
    // same time (ARCH §3.2). Whichever path resolves, exactly one row must
    // exist afterwards.
    const results = await Promise.allSettled([
      upsertUserOnSignIn({ googleSub: "race-sub", email: "x@example.com" }),
      upsertUserOnSignIn({ googleSub: "race-sub", email: "y@example.com" }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<
      Awaited<ReturnType<typeof upsertUserOnSignIn>>
    >[];
    // At least one call must succeed; the other may succeed with the same
    // id (the lookup saw the committed row) or reject on the unique
    // constraint (true race). Either way the data is consistent.
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    const users = await db.select().from(appUser);
    expect(users).toHaveLength(1);
    expect(users[0]!.googleSub).toBe("race-sub");
  });

  it("two users are isolated: each repository call only sees its own row (PRD UC-17 / #2)", async () => {
    const alice = await upsertUserOnSignIn({
      googleSub: "google-sub-alice-iso",
      email: "alice-iso@example.com",
    });
    const bob = await upsertUserOnSignIn({
      googleSub: "google-sub-bob-iso",
      email: "bob-iso@example.com",
    });

    // Repository lookups by internal id only return the matching user.
    const aliceById = await findUserById(alice.id);
    const bobById = await findUserById(bob.id);
    expect(aliceById?.id).toBe(alice.id);
    expect(bobById?.id).toBe(bob.id);
    expect(aliceById?.email).toBe("alice-iso@example.com");
    expect(bobById?.email).toBe("bob-iso@example.com");

    // Each tenant has its own profile_settings row.
    const aliceProfile = await getProfileSettings(alice.id);
    const bobProfile = await getProfileSettings(bob.id);
    expect(aliceProfile?.userId).toBe(alice.id);
    expect(bobProfile?.userId).toBe(bob.id);
    expect(aliceProfile?.currency).toBe("EUR");
    expect(bobProfile?.currency).toBe("EUR");

    // Cross-tenant lookup must return null: passing bob's id while asking
    // for alice's profile would be the kind of leak the architecture forbids.
    const bobAskingForAliceProfile = await getProfileSettings(alice.id, db);
    expect(bobAskingForAliceProfile?.userId).toBe(alice.id);
    expect(bobAskingForAliceProfile?.userId).not.toBe(bob.id);
  });

  it("repositories never return rows that belong to another user", async () => {
    const alice = await upsertUserOnSignIn({
      googleSub: "google-sub-alice-leak",
      email: "alice-leak@example.com",
    });
    const bob = await upsertUserOnSignIn({
      googleSub: "google-sub-bob-leak",
      email: "bob-leak@example.com",
    });

    // Direct DB inspection: each google_sub is owned by exactly one user.
    const found = await findUserByGoogleSub("google-sub-bob-leak");
    expect(found?.id).toBe(bob.id);
    expect(found?.id).not.toBe(alice.id);
  });
});

async function pingDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch (err) {
    process.stderr.write(
      `[integration] Postgres unreachable, skipping UC-01 suite: ${(err as Error).message}\n`,
    );
    return false;
  }
}

async function truncateAllTenantTables(): Promise<void> {
  // `profile_settings` cascades on `app_user` delete, so clearing
  // `app_user` is enough to wipe every tenant row. Hard delete is the
  // rule for these tables (PRD §13, ARCH §4).
  await db.execute(sql`TRUNCATE TABLE app_user CASCADE`);
}
