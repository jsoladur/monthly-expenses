import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { template } from "@/server/db/schema";
import { createCategory } from "@/server/services/categories";
import {
  EmptyScheduleError,
  InvalidScheduleError,
  TemplateNotFoundError,
  createTemplate,
  deleteTemplate,
  listTemplatesForManagement,
  updateTemplate,
} from "@/server/services/templates";
import { createMonth } from "@/server/services/months";
import { addActual } from "@/server/services/actuals";
import { getOverspendWarnings } from "@/server/services/summary";

// ============================================================================
// UC-20 fixed expense hard delete & month schedule — integration
// (PRD §15 #35–#40, C23).
//
// Skipped (not failed) when Postgres is unreachable, like the other suites.
// ============================================================================

const reachable = await pingDatabase();

const suite = reachable ? describe : describe.skip;

suite("UC-20 fixed expense delete & month schedule", () => {
  beforeAll(async () => {
    await truncateAllTenantTables();
  });

  afterEach(async () => {
    await truncateAllTenantTables();
  });

  afterAll(async () => {
    await db.$client.end({ timeout: 1 });
  });

  it("#35 hard delete removes the row; earlier month keeps its line; next clone skips it", async () => {
    const userId = await seedUser("google-sub-uc20-delete");
    const gymCat = await createCategory(userId, { kind: "expense", name: "Sport" });
    const gym = await createTemplate(userId, {
      categoryId: gymCat.id,
      name: "Gym",
      amount: "40.00",
      kind: "committed",
    });
    const august = await createMonth(userId, { year: 2026, month: 8 });

    await deleteTemplate(userId, { id: gym.id });

    const rows = await db.execute(sql`SELECT id FROM template WHERE id = ${gym.id}`);
    expect(rows.length).toBe(0);
    expect(await listTemplatesForManagement(userId, undefined)).toHaveLength(0);
    expect(await lineNames(august.id)).toEqual(["Gym"]);

    const september = await createMonth(userId, { year: 2026, month: 9 });
    expect(await lineNames(september.id)).toEqual([]);
  });

  it("#35 hard delete also works on an inactive template", async () => {
    const userId = await seedUser("google-sub-uc20-delete-inactive");
    const cat = await createCategory(userId, { kind: "expense", name: "Misc" });
    const tpl = await createTemplate(userId, {
      categoryId: cat.id,
      name: "Old",
      amount: "10.00",
      kind: "estimated",
    });
    await db.update(template).set({ active: false }).where(sql`${template.id} = ${tpl.id}`);
    await deleteTemplate(userId, { id: tpl.id });
    expect(await listTemplatesForManagement(userId, undefined)).toHaveLength(0);
  });

  it("#36 a scheduled template is cloned only into its month-numbers", async () => {
    const userId = await seedUser("google-sub-uc20-clone");
    const utilities = await createCategory(userId, { kind: "expense", name: "Utilities" });
    const housing = await createCategory(userId, { kind: "expense", name: "Housing" });
    await createTemplate(userId, {
      categoryId: utilities.id,
      name: "Water",
      amount: "60.00",
      kind: "committed",
      months: [1, 3, 7, 10],
    });
    await createTemplate(userId, {
      categoryId: housing.id,
      name: "Mortgage",
      amount: "800.00",
      kind: "committed",
    });

    const jan = await createMonth(userId, { year: 2027, month: 1 });
    const feb = await createMonth(userId, { year: 2027, month: 2 });

    expect((await lineNames(jan.id)).sort()).toEqual(["Mortgage", "Water"]);
    expect(await lineNames(feb.id)).toEqual(["Mortgage"]);
  });

  it("#37 schedule normalization on create and update", async () => {
    const userId = await seedUser("google-sub-uc20-normalize");
    const cat = await createCategory(userId, { kind: "expense", name: "Utilities" });
    const all12 = await createTemplate(userId, {
      categoryId: cat.id,
      name: "Power",
      amount: "50.00",
      kind: "committed",
      months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    });
    expect(all12.months).toBeNull();

    const updated = await updateTemplate(userId, {
      id: all12.id,
      categoryId: cat.id,
      name: "Power",
      amount: "50.00",
      kind: "committed",
      months: [3, 1, 3],
    });
    expect(updated.months).toEqual([1, 3]);

    await expect(
      createTemplate(userId, {
        categoryId: cat.id,
        name: "Nothing",
        amount: "1.00",
        kind: "committed",
        months: [],
      }),
    ).rejects.toBeInstanceOf(EmptyScheduleError);
    await expect(
      createTemplate(userId, {
        categoryId: cat.id,
        name: "Bad",
        amount: "1.00",
        kind: "committed",
        months: [13],
      }),
    ).rejects.toBeInstanceOf(InvalidScheduleError);
  });

  it("#38 overspend plan counts only templates that apply to the open month", async () => {
    const userId = await seedUser("google-sub-uc20-overspend");
    const utilities = await createCategory(userId, { kind: "expense", name: "Utilities" });
    await createTemplate(userId, {
      categoryId: utilities.id,
      name: "Water",
      amount: "60.00",
      kind: "committed",
      months: [1],
    });
    await createTemplate(userId, {
      categoryId: utilities.id,
      name: "Power",
      amount: "50.00",
      kind: "estimated",
    });
    const jan = await createMonth(userId, { year: 2027, month: 1 });
    const feb = await createMonth(userId, { year: 2027, month: 2 });
    for (const m of [jan, feb]) {
      await addActual(userId, {
        monthId: m.id,
        categoryId: utilities.id,
        name: "Bills",
        amount: "70.00",
      });
    }

    expect(await getOverspendWarnings(userId, jan.id)).toEqual([]);
    const febWarnings = await getOverspendWarnings(userId, feb.id);
    expect(febWarnings).toHaveLength(1);
    expect(febWarnings[0]?.estimatedTemplateTotal).toBe(5000);
    expect(febWarnings[0]?.overrunCents).toBe(2000);
  });

  it("#39 user B cannot delete or reschedule user A's template", async () => {
    const alice = await seedUser("google-sub-uc20-alice");
    const bob = await seedUser("google-sub-uc20-bob");
    const aliceCat = await createCategory(alice, { kind: "expense", name: "Utilities" });
    const bobCat = await createCategory(bob, { kind: "expense", name: "Utilities" });
    const water = await createTemplate(alice, {
      categoryId: aliceCat.id,
      name: "Water",
      amount: "60.00",
      kind: "committed",
    });

    await expect(deleteTemplate(bob, { id: water.id })).rejects.toBeInstanceOf(
      TemplateNotFoundError,
    );
    await expect(
      updateTemplate(bob, {
        id: water.id,
        categoryId: bobCat.id,
        name: "Water",
        amount: "60.00",
        kind: "committed",
        months: [1],
      }),
    ).rejects.toBeInstanceOf(TemplateNotFoundError);

    const [stillThere] = await listTemplatesForManagement(alice, undefined);
    expect(stillThere?.months).toBeNull();
  });

  it("#40 rescheduling or deleting a template never changes existing months", async () => {
    const userId = await seedUser("google-sub-uc20-no-sync");
    const cat = await createCategory(userId, { kind: "expense", name: "Utilities" });
    const water = await createTemplate(userId, {
      categoryId: cat.id,
      name: "Water",
      amount: "60.00",
      kind: "committed",
    });
    const feb = await createMonth(userId, { year: 2027, month: 2 });

    await updateTemplate(userId, {
      id: water.id,
      categoryId: cat.id,
      name: "Water",
      amount: "60.00",
      kind: "committed",
      months: [1],
    });
    expect(await lineNames(feb.id)).toEqual(["Water"]);

    await deleteTemplate(userId, { id: water.id });
    expect(await lineNames(feb.id)).toEqual(["Water"]);
  });

  it("the DB check constraint rejects an empty or 12-month schedule written directly", async () => {
    const userId = await seedUser("google-sub-uc20-check");
    const cat = await createCategory(userId, { kind: "expense", name: "Utilities" });
    const tpl = await createTemplate(userId, {
      categoryId: cat.id,
      name: "Water",
      amount: "60.00",
      kind: "committed",
    });
    await expect(
      db.update(template).set({ months: [] }).where(sql`${template.id} = ${tpl.id}`),
    ).rejects.toThrow();
    await expect(
      db
        .update(template)
        .set({ months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] })
        .where(sql`${template.id} = ${tpl.id}`),
    ).rejects.toThrow();
  });
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function seedUser(googleSub: string): Promise<string> {
  const [{ id }] = await db.execute<{ id: string }>(
    sql`INSERT INTO app_user (google_sub, email) VALUES (${googleSub}, ${`${googleSub}@example.com`}) RETURNING id`,
  );
  if (!id) {
    throw new Error("seedUser returned no id");
  }
  return id;
}

async function lineNames(monthId: string): Promise<string[]> {
  const rows = await db.execute<{ name: string }>(
    sql`SELECT name FROM month_fixed_line WHERE month_id = ${monthId} ORDER BY name`,
  );
  return rows.map((r) => r.name);
}

async function pingDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch (err) {
    process.stderr.write(
      `[integration] Postgres unreachable, skipping UC-20 suite: ${(err as Error).message}\n`,
    );
    return false;
  }
}

async function truncateAllTenantTables(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE app_user CASCADE`);
}
