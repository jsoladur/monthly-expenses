import { describe, expect, it } from "vitest";
import { cagrPercentTenths } from "@/server/money";
import {
  applyRemainingProjection,
  centsByYear,
  comparableMonths,
  contributionsToDelta,
  detectSignals,
  hccPercentTenths,
  monthlySeriesWithNulls,
  potentialSavings,
  realizedSavings,
  yearCategoryMatrix,
  type MonthCategoryCents,
  type MonthCents,
  type MonthKey,
  type StatsRange,
} from "@/server/services/global-stats-formulas";

function fullYear(year: number): MonthKey[] {
  return Array.from({ length: 12 }, (_, i) => ({ year, month: i + 1 }));
}

function months(year: number, through: number): MonthKey[] {
  return Array.from({ length: through }, (_, i) => ({ year, month: i + 1 }));
}

function flatYear(year: number, cents: number): MonthCents[] {
  return Array.from({ length: 12 }, (_, i) => ({ year, month: i + 1, cents }));
}

function catRow(
  year: number,
  month: number,
  categoryId: string,
  cents: number,
  extra: Partial<MonthCategoryCents> = {},
): MonthCategoryCents {
  return {
    year,
    month,
    categoryId,
    categoryName: extra.categoryName ?? categoryId,
    categoryKind: extra.categoryKind ?? "expense",
    categoryActive: extra.categoryActive ?? true,
    cents,
  };
}

function catYear(
  year: number,
  categoryId: string,
  monthlyCents: number,
  extra: Partial<MonthCategoryCents> = {},
): MonthCategoryCents[] {
  return Array.from({ length: 12 }, (_, i) =>
    catRow(year, i + 1, categoryId, monthlyCents, extra),
  );
}

describe("UC-15 global-stats formulas", () => {
  it("1 — realized savings = income − actuals; potential matches UC-11 when remaining ≠ 0", () => {
    expect(realizedSavings(200_000, 50_000)).toBe(150_000);
    expect(potentialSavings(200_000, 50_000, 40_000)).toBe(110_000);
    expect(potentialSavings(200_000, 0, 120_000)).toBe(80_000);
  });

  it("2 — HCC 800.00 vs 640.00 → 25.0%", () => {
    const presence = [...fullYear(2023), ...fullYear(2024)];
    const spend = [...flatYear(2023, 640_00 / 12), ...flatYear(2024, 800_00 / 12)];
    // 64000/12 is not integer — use a single-month-per-year stand-in that still
    // sums to 640.00 / 800.00 over the complete year.
    const spendExact: MonthCents[] = [
      { year: 2023, month: 1, cents: 64_000 },
      ...Array.from({ length: 11 }, (_, i) => ({ year: 2023, month: i + 2, cents: 0 })),
      { year: 2024, month: 1, cents: 80_000 },
      ...Array.from({ length: 11 }, (_, i) => ({ year: 2024, month: i + 2, cents: 0 })),
    ];
    expect(hccPercentTenths(spendExact, presence, 2024, 2023, false)).toBe(250);
    void spend;
  });

  it("3 — LFL compares only months present in both years (1–9)", () => {
    const presence = [...fullYear(2024), ...months(2025, 9)];
    expect(comparableMonths(presence, 2025, 2024, true)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const spend: MonthCents[] = [
      ...Array.from({ length: 12 }, (_, i) => ({ year: 2024, month: i + 1, cents: 10_000 })),
      ...Array.from({ length: 9 }, (_, i) => ({ year: 2025, month: i + 1, cents: 12_000 })),
    ];
    // LFL: 9×12000 vs 9×10000 → 20.0%
    expect(hccPercentTenths(spend, presence, 2025, 2024, true)).toBe(200);
    expect(centsByYear(spend, 2024, [1, 2, 3, 4, 5, 6, 7, 8, 9])).toBe(90_000);
    expect(centsByYear(spend, 2025, [1, 2, 3, 4, 5, 6, 7, 8, 9])).toBe(108_000);
  });

  it("4 — incomplete year is omitted from HCC unless LFL is on", () => {
    const presence = [...fullYear(2024), ...months(2025, 3)];
    const spend: MonthCents[] = [
      ...flatYear(2024, 10_000),
      { year: 2025, month: 1, cents: 1_000 },
      { year: 2025, month: 2, cents: 1_000 },
      { year: 2025, month: 3, cents: 1_000 },
    ];
    expect(hccPercentTenths(spend, presence, 2025, 2024, false)).toBeNull();
    expect(hccPercentTenths(spend, presence, 2025, 2024, true)).not.toBeNull();
  });

  it("5 — missing March is null, not 0", () => {
    const presence: MonthKey[] = [
      { year: 2024, month: 1 },
      { year: 2024, month: 2 },
      { year: 2024, month: 4 },
    ];
    const spend: MonthCents[] = [
      { year: 2024, month: 1, cents: 100 },
      { year: 2024, month: 2, cents: 200 },
      { year: 2024, month: 4, cents: 400 },
    ];
    const series = monthlySeriesWithNulls(presence, spend, 2024, 2024);
    expect(series.find((r) => r.month === 3)?.cents).toBeNull();
    expect(series.find((r) => r.month === 2)?.cents).toBe(200);
  });

  it("6 — contributions sum to ΔS; Other holds the remainder", () => {
    const rows: MonthCategoryCents[] = [
      catRow(2023, 1, "a", 100, { categoryName: "A" }),
      catRow(2023, 1, "b", 50, { categoryName: "B" }),
      catRow(2023, 1, "c", 20, { categoryName: "C" }),
      catRow(2023, 1, "d", 10, { categoryName: "D" }),
      catRow(2024, 1, "a", 150, { categoryName: "A" }),
      catRow(2024, 1, "b", 40, { categoryName: "B" }),
      catRow(2024, 1, "c", 25, { categoryName: "C" }),
      catRow(2024, 1, "d", 30, { categoryName: "D" }),
    ];
    const deltaS = 150 + 40 + 25 + 30 - (100 + 50 + 20 + 10);
    const contrib = contributionsToDelta(rows, 2024, 2023, undefined, 2);
    const sum = contrib.reduce((acc, r) => acc + r.deltaCents, 0);
    expect(sum).toBe(deltaS);
    expect(contrib.some((r) => r.other)).toBe(true);
  });

  it("8 — CAGR skipped when base spend is 0", () => {
    expect(cagrPercentTenths(0, 50_000, 3)).toBeNull();
  });

  it("9 — inactive (soft-deleted) categories still appear in the matrix", () => {
    const presence = [...fullYear(2023), ...fullYear(2024)];
    const byCat = [
      ...catYear(2023, "old", 1_000, { categoryName: "Old", categoryActive: false }),
      ...catYear(2024, "old", 1_200, { categoryName: "Old", categoryActive: false }),
    ];
    const matrix = yearCategoryMatrix(byCat, presence, [2023, 2024], false);
    expect(matrix.some((c) => c.categoryId === "old" && c.categoryActive === false)).toBe(true);
    expect(matrix.find((c) => c.year === 2024 && c.categoryId === "old")?.cents).toBe(14_400);
  });

  it("projection adds remaining into that month only", () => {
    const spend: MonthCents[] = [{ year: 2026, month: 8, cents: 10_000 }];
    const remaining: MonthCents[] = [{ year: 2026, month: 8, cents: 4_000 }];
    const projected = applyRemainingProjection(spend, remaining, { year: 2026, month: 8 });
    expect(projected[0]?.cents).toBe(14_000);
    expect(applyRemainingProjection(spend, remaining, null)[0]?.cents).toBe(10_000);
  });
});

describe("UC-15 detectors (§11.1 fire / not-fire)", () => {
  const range: StatsRange = { fromYear: 2022, toYear: 2025, lfl: false };

  function pairYears(opts: {
    incPrev: number;
    incNow: number;
    spendPrev: number;
    spendNow: number;
    yearNow?: number;
  }) {
    const yearNow = opts.yearNow ?? 2025;
    const prior = yearNow - 1;
    const presence = [...fullYear(prior), ...fullYear(yearNow)];
    const income: MonthCents[] = [
      { year: prior, month: 1, cents: opts.incPrev },
      ...Array.from({ length: 11 }, (_, i) => ({ year: prior, month: i + 2, cents: 0 })),
      { year: yearNow, month: 1, cents: opts.incNow },
      ...Array.from({ length: 11 }, (_, i) => ({ year: yearNow, month: i + 2, cents: 0 })),
    ];
    const spend: MonthCents[] = [
      { year: prior, month: 1, cents: opts.spendPrev },
      ...Array.from({ length: 11 }, (_, i) => ({ year: prior, month: i + 2, cents: 0 })),
      { year: yearNow, month: 1, cents: opts.spendNow },
      ...Array.from({ length: 11 }, (_, i) => ({ year: yearNow, month: i + 2, cents: 0 })),
    ];
    return { presence, income, spend, remaining: [] as MonthCents[], yearNow, prior };
  }

  function ids(signals: { id: string }[]): string[] {
    return signals.map((s) => s.id);
  }

  it("savingsRateDrop fires at ≥ 5 pp and not below", () => {
    // rate 20.0% → 14.9% is 5.1 pp; 20.0% → 15.1% is 4.9 pp
    const fire = pairYears({ incPrev: 100_000, spendPrev: 80_000, incNow: 100_000, spendNow: 85_100 });
    const no = pairYears({ incPrev: 100_000, spendPrev: 80_000, incNow: 100_000, spendNow: 84_900 });
    expect(ids(detectSignals({ ...fire, incomeByCat: [], spendByCat: [], range, now: new Date("2025-06-01") }))).toContain(
      "savingsRateDrop",
    );
    expect(ids(detectSignals({ ...no, incomeByCat: [], spendByCat: [], range, now: new Date("2025-06-01") }))).not.toContain(
      "savingsRateDrop",
    );
  });

  it("spendOutpacingIncome fires when HCC exceeds income change by ≥ 3 pp", () => {
    // income +1.0%, spend +5.0% → gap 4.0 pp
    const fire = pairYears({ incPrev: 100_000, incNow: 101_000, spendPrev: 100_000, spendNow: 105_000 });
    const no = pairYears({ incPrev: 100_000, incNow: 105_000, spendPrev: 100_000, spendNow: 105_000 });
    expect(ids(detectSignals({ ...fire, incomeByCat: [], spendByCat: [], range, now: new Date("2025-06-01") }))).toContain(
      "spendOutpacingIncome",
    );
    expect(ids(detectSignals({ ...no, incomeByCat: [], spendByCat: [], range, now: new Date("2025-06-01") }))).not.toContain(
      "spendOutpacingIncome",
    );
  });

  it("categoryRunaway fires at ≥ 15% YoY faster than income; spike at ≥ 25%", () => {
    const base = pairYears({ incPrev: 200_000, incNow: 202_000, spendPrev: 100_000, spendNow: 100_000 });
    const runaway: MonthCategoryCents[] = [
      catRow(2024, 1, "food", 10_000),
      catRow(2025, 1, "food", 11_600), // +16%
    ];
    const spike: MonthCategoryCents[] = [
      catRow(2024, 1, "food", 10_000),
      catRow(2025, 1, "food", 12_600), // +26%
    ];
    const mild: MonthCategoryCents[] = [
      catRow(2024, 1, "food", 10_000),
      catRow(2025, 1, "food", 10_500), // +5%
    ];
    expect(ids(detectSignals({ ...base, incomeByCat: [], spendByCat: runaway, range, now: new Date("2025-06-01") }))).toContain(
      "categoryRunaway",
    );
    expect(ids(detectSignals({ ...base, incomeByCat: [], spendByCat: spike, range, now: new Date("2025-06-01") }))).toContain(
      "categorySpike",
    );
    expect(ids(detectSignals({ ...base, incomeByCat: [], spendByCat: mild, range, now: new Date("2025-06-01") }))).not.toContain(
      "categoryRunaway",
    );
  });

  it("newCategoryMaterial fires at ≥ 5% of latest spend with 0 prior", () => {
    const base = pairYears({ incPrev: 200_000, incNow: 200_000, spendPrev: 100_000, spendNow: 100_000 });
    const material: MonthCategoryCents[] = [catRow(2025, 1, "new", 6_000)];
    const tiny: MonthCategoryCents[] = [catRow(2025, 1, "new", 4_000)];
    expect(ids(detectSignals({ ...base, incomeByCat: [], spendByCat: material, range, now: new Date("2025-06-01") }))).toContain(
      "newCategoryMaterial",
    );
    expect(ids(detectSignals({ ...base, incomeByCat: [], spendByCat: tiny, range, now: new Date("2025-06-01") }))).not.toContain(
      "newCategoryMaterial",
    );
  });

  it("housingBurden fires when largest expense ≥ 30% of income", () => {
    const fire = pairYears({ incPrev: 100_000, incNow: 100_000, spendPrev: 40_000, spendNow: 40_000 });
    const no = pairYears({ incPrev: 100_000, incNow: 100_000, spendPrev: 20_000, spendNow: 20_000 });
    const catsFire: MonthCategoryCents[] = [catRow(2025, 1, "rent", 40_000), catRow(2024, 1, "rent", 40_000)];
    const catsNo: MonthCategoryCents[] = [catRow(2025, 1, "rent", 20_000), catRow(2024, 1, "rent", 20_000)];
    expect(ids(detectSignals({ ...fire, incomeByCat: [], spendByCat: catsFire, range, now: new Date("2025-06-01") }))).toContain(
      "housingBurden",
    );
    expect(ids(detectSignals({ ...no, incomeByCat: [], spendByCat: catsNo, range, now: new Date("2025-06-01") }))).not.toContain(
      "housingBurden",
    );
  });

  it("incomeConcentration fires at ≥ 85% from one income category", () => {
    const base = pairYears({ incPrev: 100_000, incNow: 100_000, spendPrev: 50_000, spendNow: 50_000 });
    const concentrated: MonthCategoryCents[] = [
      catRow(2025, 1, "salary", 90_000, { categoryKind: "income" }),
      catRow(2025, 1, "side", 10_000, { categoryKind: "income" }),
    ];
    const split: MonthCategoryCents[] = [
      catRow(2025, 1, "salary", 50_000, { categoryKind: "income" }),
      catRow(2025, 1, "side", 50_000, { categoryKind: "income" }),
    ];
    expect(
      ids(detectSignals({ ...base, incomeByCat: concentrated, spendByCat: [], range, now: new Date("2025-06-01") })),
    ).toContain("incomeConcentration");
    expect(
      ids(detectSignals({ ...base, incomeByCat: split, spendByCat: [], range, now: new Date("2025-06-01") })),
    ).not.toContain("incomeConcentration");
  });

  it("incomeSourceGone fires when a ≥10% source two years ago is 0 in the latest complete year", () => {
    const presence = [...fullYear(2023), ...fullYear(2024), ...fullYear(2025)];
    const income: MonthCents[] = [
      { year: 2023, month: 1, cents: 100_000 },
      { year: 2024, month: 1, cents: 90_000 },
      { year: 2025, month: 1, cents: 90_000 },
    ];
    const incomeByCat: MonthCategoryCents[] = [
      catRow(2023, 1, "bonus", 15_000, { categoryKind: "income" }),
      catRow(2023, 1, "salary", 85_000, { categoryKind: "income" }),
      catRow(2024, 1, "salary", 90_000, { categoryKind: "income" }),
      catRow(2025, 1, "salary", 90_000, { categoryKind: "income" }),
    ];
    const stillThere: MonthCategoryCents[] = [
      ...incomeByCat,
      catRow(2025, 1, "bonus", 1_000, { categoryKind: "income" }),
    ];
    expect(
      ids(
        detectSignals({
          presence,
          income,
          spend: [],
          remaining: [],
          incomeByCat,
          spendByCat: [],
          range,
          now: new Date("2025-06-01"),
        }),
      ),
    ).toContain("incomeSourceGone");
    expect(
      ids(
        detectSignals({
          presence,
          income,
          spend: [],
          remaining: [],
          incomeByCat: stillThere,
          spendByCat: [],
          range,
          now: new Date("2025-06-01"),
        }),
      ),
    ).not.toContain("incomeSourceGone");
  });

  it("deficitMonth and deficitYear fire only when spend exceeds income", () => {
    const fire = pairYears({ incPrev: 50_000, incNow: 50_000, spendPrev: 80_000, spendNow: 80_000 });
    const no = pairYears({ incPrev: 80_000, incNow: 80_000, spendPrev: 50_000, spendNow: 50_000 });
    expect(ids(detectSignals({ ...fire, incomeByCat: [], spendByCat: [], range, now: new Date("2025-06-01") }))).toEqual(
      expect.arrayContaining(["deficitMonth", "deficitYear"]),
    );
    expect(ids(detectSignals({ ...no, incomeByCat: [], spendByCat: [], range, now: new Date("2025-06-01") }))).not.toContain(
      "deficitMonth",
    );
  });

  it("seasonalityPeak fires when peak month ≥ 1.4× monthly average", () => {
    const presence = fullYear(2024);
    const spend: MonthCents[] = Array.from({ length: 12 }, (_, i) => ({
      year: 2024,
      month: i + 1,
      cents: i === 11 ? 14_000 : 1_000,
    }));
    const even: MonthCents[] = flatYear(2024, 1_000);
    expect(
      ids(
        detectSignals({
          presence,
          income: flatYear(2024, 20_000),
          spend,
          remaining: [],
          incomeByCat: [],
          spendByCat: [],
          range: { fromYear: 2024, toYear: 2024, lfl: false },
          now: new Date("2025-06-01"),
        }),
      ),
    ).toContain("seasonalityPeak");
    expect(
      ids(
        detectSignals({
          presence,
          income: flatYear(2024, 20_000),
          spend: even,
          remaining: [],
          incomeByCat: [],
          spendByCat: [],
          range: { fromYear: 2024, toYear: 2024, lfl: false },
          now: new Date("2025-06-01"),
        }),
      ),
    ).not.toContain("seasonalityPeak");
  });

  it("openMonthReserve fires when latest month remaining > 0", () => {
    const presence = [{ year: 2026, month: 8 }];
    expect(
      ids(
        detectSignals({
          presence,
          income: [],
          spend: [],
          remaining: [{ year: 2026, month: 8, cents: 500 }],
          incomeByCat: [],
          spendByCat: [],
          range: { fromYear: 2026, toYear: 2026, lfl: false },
          now: new Date("2026-08-15"),
        }),
      ),
    ).toContain("openMonthReserve");
  });

  it("sparseYear fires for a non-current incomplete year", () => {
    const presence = months(2020, 4);
    expect(
      ids(
        detectSignals({
          presence,
          income: [],
          spend: [],
          remaining: [],
          incomeByCat: [],
          spendByCat: [],
          range: { fromYear: 2020, toYear: 2020, lfl: false },
          now: new Date("2026-08-15"),
        }),
      ),
    ).toContain("sparseYear");
  });

  it("threeYearCagr is emitted as a table even below alert thresholds; skips zero base", () => {
    const presence = [...fullYear(2022), ...fullYear(2025)];
    const spendByCat: MonthCategoryCents[] = [
      ...catYear(2022, "food", 1_000, { categoryName: "Food" }),
      ...catYear(2025, "food", 1_100, { categoryName: "Food" }),
      ...catYear(2025, "new", 5_000, { categoryName: "New" }),
    ];
    const signals = detectSignals({
      presence,
      income: [...flatYear(2022, 20_000), ...flatYear(2025, 20_000)],
      spend: [...flatYear(2022, 1_000), ...flatYear(2025, 6_100)],
      remaining: [],
      incomeByCat: [],
      spendByCat,
      range: { fromYear: 2022, toYear: 2025, lfl: false },
      now: new Date("2026-01-01"),
    });
    const cagr = signals.find((s) => s.id === "threeYearCagr");
    expect(cagr).toBeDefined();
    expect(String(cagr?.metrics.table)).toContain("food");
    expect(String(cagr?.metrics.table)).not.toContain("new:");
  });
});
