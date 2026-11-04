import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { createCategory } from "@/server/services/categories";
import { createAnnual, getAnnualReminders } from "@/server/services/annuals";
import { createMonth, MonthNotFoundError } from "@/server/services/months";
import { addActual, deleteActual } from "@/server/services/actuals";
import { addMonthOnlyLine, deleteMonthLine } from "@/server/services/reserved-lines";

// ============================================================================
// UC-28 annual reminder "already added" state (proposed PRD §15 #62–#65).
// ============================================================================

const reachable = await pingDatabase();
const suite = reachable ? describe : describe.skip;

suite("UC-28 annual reminder match", () => {
  beforeAll(async () => {
    await truncateAllTenantTables();
  });

  afterEach(async () => {
    await truncateAllTenantTables();
  });

  afterAll(async () => {
    await db.$client.end({ timeout: 1 });
  });

  it("#62 a reserved line in the same category marks the reminder as added", async () => {
    const userId = await seedUser("google-sub-uc28-62");
    const transport = await createCategory(userId, { kind: "expense", name: "Transport" });
    await createAnnual(userId, {
      categoryId: transport.id,
      name: "Car insurance",
      chargeMonth: 3,
      isDirectDebit: true,
    });
    const march = await createMonth(userId, { year: 2026, month: 3 });
    await addMonthOnlyLine(userId, {
      monthId: march.id,
      categoryId: transport.id,
      name: "Car insurance 2026",
      amount: "412.50",
      kind: "committed",
    });

    const [reminder] = await getAnnualReminders(userId, march.id);
    expect(reminder?.match).toEqual({
      source: "reserved",
      name: "Car insurance 2026",
      amountCents: 41250,
    });
  });

  it("#63 the same name in a different category is not a match", async () => {
    const userId = await seedUser("google-sub-uc28-63");
    const transport = await createCategory(userId, { kind: "expense", name: "Transport" });
    const housing = await createCategory(userId, { kind: "expense", name: "Housing" });
    await createAnnual(userId, {
      categoryId: transport.id,
      name: "Car insurance",
      chargeMonth: 3,
      isDirectDebit: false,
    });
    const march = await createMonth(userId, { year: 2026, month: 3 });
    await addActual(userId, {
      monthId: march.id,
      categoryId: housing.id,
      name: "Car insurance",
      amount: "400.00",
    });

    const reminders = await getAnnualReminders(userId, march.id);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.match).toBeNull();
  });

  it("#64 accent/case folding: 'Seguro hogar' matches actual 'SEGURO HOGAR mapfre'", async () => {
    const userId = await seedUser("google-sub-uc28-64");
    const housing = await createCategory(userId, { kind: "expense", name: "Vivienda" });
    await createAnnual(userId, {
      categoryId: housing.id,
      name: "Séguro hogar",
      chargeMonth: 6,
      isDirectDebit: false,
    });
    const june = await createMonth(userId, { year: 2026, month: 6 });
    await addActual(userId, {
      monthId: june.id,
      categoryId: housing.id,
      name: "SEGURO HOGAR mapfre",
      amount: "210.00",
    });

    const [reminder] = await getAnnualReminders(userId, june.id);
    expect(reminder?.match).toEqual({
      source: "actual",
      name: "SEGURO HOGAR mapfre",
      amountCents: 21000,
    });
  });

  it("#65 hard-deleting the matching line brings the full reminder back", async () => {
    const userId = await seedUser("google-sub-uc28-65");
    const transport = await createCategory(userId, { kind: "expense", name: "Transport" });
    await createAnnual(userId, {
      categoryId: transport.id,
      name: "Car insurance",
      chargeMonth: 3,
      isDirectDebit: false,
    });
    const march = await createMonth(userId, { year: 2026, month: 3 });
    const line = await addMonthOnlyLine(userId, {
      monthId: march.id,
      categoryId: transport.id,
      name: "Car insurance",
      amount: "400.00",
      kind: "estimated",
    });
    const ticket = await addActual(userId, {
      monthId: march.id,
      categoryId: transport.id,
      name: "Car insurance March",
      amount: "395.00",
    });

    // Reserved wins over the actual.
    expect((await getAnnualReminders(userId, march.id))[0]?.match?.source).toBe("reserved");

    await deleteMonthLine(userId, { lineId: line.id });
    expect((await getAnnualReminders(userId, march.id))[0]?.match?.source).toBe("actual");

    await deleteActual(userId, { id: ticket.id });
    expect((await getAnnualReminders(userId, march.id))[0]?.match).toBeNull();
  });

  it("tenancy: another user's month id is rejected, and their lines never match", async () => {
    const owner = await seedUser("google-sub-uc28-owner");
    const intruder = await seedUser("google-sub-uc28-intruder");
    const ownerCat = await createCategory(owner, { kind: "expense", name: "Transport" });
    const ownerMarch = await createMonth(owner, { year: 2026, month: 3 });
    await addActual(owner, {
      monthId: ownerMarch.id,
      categoryId: ownerCat.id,
      name: "Car insurance",
      amount: "400.00",
    });

    await expect(getAnnualReminders(intruder, ownerMarch.id)).rejects.toBeInstanceOf(
      MonthNotFoundError,
    );
  });

  it("other months' lines do not count", async () => {
    const userId = await seedUser("google-sub-uc28-other-month");
    const transport = await createCategory(userId, { kind: "expense", name: "Transport" });
    await createAnnual(userId, {
      categoryId: transport.id,
      name: "Car insurance",
      chargeMonth: 3,
      isDirectDebit: false,
    });
    const feb = await createMonth(userId, { year: 2026, month: 2 });
    const march = await createMonth(userId, { year: 2026, month: 3 });
    await addActual(userId, {
      monthId: feb.id,
      categoryId: transport.id,
      name: "Car insurance",
      amount: "400.00",
    });

    expect((await getAnnualReminders(userId, march.id))[0]?.match).toBeNull();
  });
});

async function pingDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch (err) {
    process.stderr.write(
      `[integration] Postgres unreachable, skipping UC-28 suite: ${(err as Error).message}\n`,
    );
    return false;
  }
}

async function truncateAllTenantTables(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE app_user CASCADE`);
}

async function seedUser(googleSub: string): Promise<string> {
  const [{ id }] = await db.execute<{ id: string }>(
    sql`INSERT INTO app_user (google_sub, email) VALUES (${googleSub}, ${`${googleSub}@example.com`}) RETURNING id`,
  );
  if (!id) {
    throw new Error("seedUser returned no id");
  }
  return id;
}
