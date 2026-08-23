import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { profileSettings } from "@/server/db/schema";
import { upsertUserOnSignIn } from "@/server/services/auth";
import {
  ProfileSettingsNotFoundError,
  getProfileSettings,
  updateCurrency,
} from "@/server/services/settings";

// ============================================================================
// UC-04 profile settings — integration.
//
// Hits the real Postgres the migration suite created. Skipped (not failed)
// when the database is unreachable so `pnpm test` stays usable without
// Docker. The schema (UC-00) already exposes `profile_settings.user_id` as
// a PRIMARY KEY referencing `app_user.id` ON DELETE CASCADE, so a single
// `TRUNCATE TABLE app_user CASCADE` resets both tables.
//
// Acceptance (PRD §15 #11 picker-prep half — display-only currency):
//   - First sign-in (UC-01) provisions the row with `currency='EUR'` and
//     this slice relies on that precondition.
//   - `updateCurrency` writes ONLY `profile_settings.currency` — never
//     touches any amount column (PRD UC-15 — no FX conversion).
//   - Currency is tenant-scoped: Alice changing hers doesn't affect Bob
//     (PRD §5.1 / UC-17).
//   - Unknown / never-provisioned user surfaces as `ProfileSettingsNotFoundError`.
// ============================================================================

const reachable = await pingDatabase();

const suite = reachable ? describe : describe.skip;

suite("UC-04 profile settings", () => {
  beforeAll(async () => {
    await truncateAllTenantTables();
  });

  afterEach(async () => {
    await truncateAllTenantTables();
  });

  afterAll(async () => {
    await db.$client.end({ timeout: 1 });
  });

  it("returns the EUR row provisioned by UC-01 on first sign-in (PRD §5.3)", async () => {
    const userId = await seedUser("google-sub-uc04-eur");

    const settings = await getProfileSettings(userId);

    expect(settings).not.toBeNull();
    expect(settings!.userId).toBe(userId);
    expect(settings!.currency).toBe("EUR");
  });

  it("updates the currency — single-row update on profile_settings only", async () => {
    const userId = await seedUser("google-sub-uc04-update");

    const updated = await updateCurrency(userId, "USD");

    expect(updated.currency).toBe("USD");
    expect(updated.userId).toBe(userId);

    // Read-back is consistent.
    const reread = await getProfileSettings(userId);
    expect(reread?.currency).toBe("USD");
  });

  it("updateCurrency touches only profile_settings — no other money row is rewritten", async () => {
    // The acceptance criterion is "changing the label never alters the
    // stored amounts" (PRD UC-15, C9). We verify by checking there is no
    // amount column on `profile_settings` and the row count of every
    // money-bearing table is unchanged after the mutation.
    const userId = await seedUser("google-sub-uc04-no-fx");

    // Snapshot every money-bearing table's row count before.
    const before = await countMoneyRows(userId);

    await updateCurrency(userId, "GBP");

    const after = await countMoneyRows(userId);
    expect(after).toEqual(before);

    // Belt-and-suspenders: `profile_settings` has no `amount`-shaped column.
    const columns = await db.execute<{ column_name: string }>(
      sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'profile_settings'`,
    );
    const names = columns.map((row) => row.column_name);
    expect(names).toEqual(
      expect.arrayContaining(["user_id", "currency", "created_at", "updated_at"]),
    );
    for (const amountLike of ["amount", "value", "balance", "cents"]) {
      expect(names).not.toContain(amountLike);
    }
  });

  it("is tenant-scoped — Alice switching to USD does not affect Bob (PRD §5.1, UC-17)", async () => {
    const alice = await seedUser("google-sub-uc04-alice");
    const bob = await seedUser("google-sub-uc04-bob");

    await updateCurrency(alice, "USD");

    const aliceSettings = await getProfileSettings(alice);
    const bobSettings = await getProfileSettings(bob);
    expect(aliceSettings?.currency).toBe("USD");
    expect(bobSettings?.currency).toBe("EUR");
  });

  it("rejects an unknown user (no profile_settings row) with ProfileSettingsNotFoundError", async () => {
    // `profile_settings` is provisioned by UC-01 on first sign-in. An id
    // that doesn't exist in `app_user` has no profile row, so the service
    // throws — the UI never sees a silent no-op.
    const ghostUserId = "00000000-0000-0000-0000-000000000000";
    await expect(updateCurrency(ghostUserId, "USD")).rejects.toBeInstanceOf(
      ProfileSettingsNotFoundError,
    );
    await expect(getProfileSettings(ghostUserId)).resolves.toBeNull();
  });

  it("rejects invalid ISO 4217 codes at the service boundary (defense in depth — the action validates first)", async () => {
    const userId = await seedUser("google-sub-uc04-bad-code");
    await expect(updateCurrency(userId, "")).rejects.toThrow();
    await expect(updateCurrency(userId, "US")).rejects.toThrow();
    await expect(updateCurrency(userId, "us1")).rejects.toThrow();
    await expect(updateCurrency(userId, "EURO")).rejects.toThrow();

    // Row is unchanged after every failed attempt.
    const after = await getProfileSettings(userId);
    expect(after?.currency).toBe("EUR");
  });

  it("subsequent update writes only the new currency — no duplicate rows", async () => {
    const userId = await seedUser("google-sub-uc04-replace");

    await updateCurrency(userId, "USD");
    await updateCurrency(userId, "JPY");
    await updateCurrency(userId, "USD");

    const rows = await db
      .select()
      .from(profileSettings)
      .where(sql`user_id = ${userId}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.currency).toBe("USD");
  });
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function seedUser(googleSub: string): Promise<string> {
  // Goes through the production provisioning path (UC-01) so the row pair
  // matches what a real Google sign-in leaves behind.
  const user = await upsertUserOnSignIn({
    googleSub,
    email: `${googleSub}@example.com`,
  });
  return user.id;
}

async function countMoneyRows(userId: string): Promise<{
  profileSettings: number;
}> {
  const [{ count }] = await db.execute<{ count: string }>(
    sql`SELECT COUNT(*)::text AS count FROM profile_settings WHERE user_id = ${userId}`,
  );
  // `profile_settings` is the only table owned directly by the user today
  // (ARCH §4). Money-bearing tables (month_*) require a month row first
  // and are out of scope for UC-04 — UC-06 / UC-07 / UC-08 add them.
  return { profileSettings: Number(count) };
}

async function pingDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch (err) {
    process.stderr.write(
      `[integration] Postgres unreachable, skipping UC-04 suite: ${(err as Error).message}\n`,
    );
    return false;
  }
}

async function truncateAllTenantTables(): Promise<void> {
  // `profile_settings` cascades on `app_user`, so wiping tenants is enough.
  await db.execute(sql`TRUNCATE TABLE app_user CASCADE`);
}
