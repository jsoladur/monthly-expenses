// ============================================================================
// Global Stats formulas (UC-15). Pure functions over integer-cents series.
// No SQL, no floats on amounts. Unit-tested in tests/unit/global-stats.test.ts.
// ============================================================================

import {
  cagrPercentTenths,
  ratioChangeToPercentTenths,
  roundHalfUpDiv,
  sumCents,
} from "@/server/money";

export type MonthKey = { year: number; month: number };

export type MonthCents = MonthKey & { cents: number };

export type MonthCategoryCents = MonthKey & {
  categoryId: string;
  categoryName: string;
  categoryKind: "income" | "expense";
  categoryActive: boolean;
  cents: number;
};

export type StatsRange = {
  fromYear: number;
  toYear: number;
  lfl: boolean;
};

export type TrendSeverity = "info" | "watch" | "risk";

export type TrendSignal = {
  id: string;
  severity: TrendSeverity;
  categoryId?: string;
  metrics: Record<string, number | string>;
};

export function periodKey(year: number, month: number): number {
  return year * 12 + month;
}

export function monthsInYear(presence: MonthKey[], year: number): number[] {
  return presence.filter((p) => p.year === year).map((p) => p.month).sort((a, b) => a - b);
}

export function isCompleteYear(presence: MonthKey[], year: number): boolean {
  return monthsInYear(presence, year).length === 12;
}

export function likeForLikeMonths(
  presence: MonthKey[],
  yearA: number,
  yearB: number,
): number[] {
  const a = new Set(monthsInYear(presence, yearA));
  const b = new Set(monthsInYear(presence, yearB));
  return [...a].filter((m) => b.has(m)).sort((x, y) => x - y);
}

export function centsByYear(
  series: MonthCents[],
  year: number,
  months?: number[],
): number {
  const allow = months ? new Set(months) : null;
  const values: number[] = [];
  for (const row of series) {
    if (row.year !== year) continue;
    if (allow && !allow.has(row.month)) continue;
    values.push(row.cents);
  }
  return sumCents(values);
}

export function monthCentsMap(series: MonthCents[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const row of series) {
    map.set(periodKey(row.year, row.month), row.cents);
  }
  return map;
}

/** Missing months stay `null`, never 0. */
export function monthlySeriesWithNulls(
  presence: MonthKey[],
  series: MonthCents[],
  fromYear: number,
  toYear: number,
): Array<{ year: number; month: number; cents: number | null }> {
  const map = monthCentsMap(series);
  const present = new Set(presence.map((p) => periodKey(p.year, p.month)));
  const out: Array<{ year: number; month: number; cents: number | null }> = [];
  for (let year = fromYear; year <= toYear; year++) {
    for (let month = 1; month <= 12; month++) {
      const key = periodKey(year, month);
      if (!present.has(key)) {
        out.push({ year, month, cents: null });
        continue;
      }
      out.push({ year, month, cents: map.get(key) ?? 0 });
    }
  }
  return out;
}

/** Rolling window over created months only (UC-15 §5). */
export function rolling12Series(
  presence: MonthKey[],
  series: MonthCents[],
): Array<{ year: number; month: number; cents: number; monthCents: number }> {
  const ordered = [...presence].sort(
    (a, b) => periodKey(a.year, a.month) - periodKey(b.year, b.month),
  );
  const map = monthCentsMap(series);
  const out: Array<{ year: number; month: number; cents: number; monthCents: number }> = [];
  const queue: number[] = [];
  let running = 0;
  for (const p of ordered) {
    const c = map.get(periodKey(p.year, p.month)) ?? 0;
    queue.push(c);
    running += c;
    if (queue.length > 12) {
      running -= queue.shift()!;
    }
    if (queue.length === 12) {
      out.push({ year: p.year, month: p.month, cents: running, monthCents: c });
    }
  }
  return out;
}

export function realizedSavings(incomeCents: number, actualCents: number): number {
  return incomeCents - actualCents;
}

export function potentialSavings(
  incomeCents: number,
  actualCents: number,
  remainingCents: number,
): number {
  return incomeCents - (actualCents + remainingCents);
}

export function savingsRateTenths(savingsCents: number, incomeCents: number): number | null {
  if (incomeCents === 0) return null;
  return Number(roundHalfUpDiv(BigInt(savingsCents) * 1000n, BigInt(incomeCents)));
}

export function sharePercentTenths(partCents: number, wholeCents: number): number | null {
  if (wholeCents === 0) return null;
  return Number(roundHalfUpDiv(BigInt(partCents) * 1000n, BigInt(wholeCents)));
}

export function comparableMonths(
  presence: MonthKey[],
  year: number,
  priorYear: number,
  lfl: boolean,
): number[] | undefined {
  const yearIncomplete = !isCompleteYear(presence, year);
  const priorIncomplete = !isCompleteYear(presence, priorYear);
  if (lfl && (yearIncomplete || priorIncomplete)) {
    return likeForLikeMonths(presence, year, priorYear);
  }
  return undefined;
}

export function yearsInRange(presence: MonthKey[], range: StatsRange): number[] {
  const set = new Set(
    presence.filter((p) => p.year >= range.fromYear && p.year <= range.toYear).map((p) => p.year),
  );
  return [...set].sort((a, b) => a - b);
}

const STATS_DEFAULT_LOOKBACK_YEARS = 5;

/** Default From = max(first recorded year, calendar year − 5), To = calendar year, clamped to years that have months. */
export function resolveStatsYearRange(
  requestedFrom: number | undefined,
  requestedTo: number | undefined,
  minYear: number | null,
  maxYear: number | null,
  now: Date,
): { fromYear: number; toYear: number } {
  const calendarYear = now.getFullYear();
  const lookbackFrom = calendarYear - STATS_DEFAULT_LOOKBACK_YEARS;
  const defaultFrom =
    minYear === null ? lookbackFrom : Math.max(minYear, lookbackFrom);
  const fromYear = clampYear(requestedFrom ?? defaultFrom, minYear, maxYear);
  const toYear = clampYear(requestedTo ?? calendarYear, minYear, maxYear);
  return {
    fromYear: Math.min(fromYear, toYear),
    toYear: Math.max(fromYear, toYear),
  };
}

function clampYear(
  value: number,
  min: number | null,
  max: number | null,
): number {
  let n = value;
  if (min !== null) n = Math.max(n, min);
  if (max !== null) n = Math.min(n, max);
  return n;
}

export function inRange(row: MonthKey, range: StatsRange): boolean {
  return row.year >= range.fromYear && row.year <= range.toYear;
}

export function filterByCategories<T extends { categoryId: string }>(
  rows: T[],
  categoryIds: string[],
): T[] {
  if (categoryIds.length === 0) return rows;
  const allow = new Set(categoryIds);
  return rows.filter((r) => allow.has(r.categoryId));
}

export function applyRemainingProjection(
  spend: MonthCents[],
  remaining: MonthCents[],
  target: MonthKey | null,
): MonthCents[] {
  if (!target) return spend;
  const extra =
    remaining.find((r) => r.year === target.year && r.month === target.month)?.cents ?? 0;
  if (extra === 0) return spend;
  const key = periodKey(target.year, target.month);
  let found = false;
  const out = spend.map((row) => {
    if (periodKey(row.year, row.month) !== key) return row;
    found = true;
    return { ...row, cents: row.cents + extra };
  });
  if (!found) {
    out.push({ year: target.year, month: target.month, cents: extra });
  }
  return out;
}

export function yearlyTotals(
  series: MonthCents[],
  years: number[],
): Array<{ year: number; cents: number }> {
  return years.map((year) => ({ year, cents: centsByYear(series, year) }));
}

export type MatrixCell = {
  year: number;
  categoryId: string;
  categoryName: string;
  categoryActive: boolean;
  cents: number;
  shareTenths: number | null;
  yoyTenths: number | null;
};

export function yearCategoryMatrix(
  byCat: MonthCategoryCents[],
  presence: MonthKey[],
  years: number[],
  lfl: boolean,
): MatrixCell[] {
  const cells: MatrixCell[] = [];
  for (const year of years) {
    const yearTotal = centsByYear(
      byCat.map((r) => ({ year: r.year, month: r.month, cents: r.cents })),
      year,
    );
    const cats = new Map<string, { name: string; active: boolean; cents: number }>();
    for (const row of byCat) {
      if (row.year !== year) continue;
      const prev = cats.get(row.categoryId) ?? {
        name: row.categoryName,
        active: row.categoryActive,
        cents: 0,
      };
      prev.cents += row.cents;
      prev.name = row.categoryName;
      prev.active = row.categoryActive;
      cats.set(row.categoryId, prev);
    }
    const priorYear = year - 1;
    const months = years.includes(priorYear)
      ? comparableMonths(presence, year, priorYear, lfl)
      : undefined;
    const omitYoy = !isCompleteYear(presence, year) && !lfl;
    for (const [categoryId, v] of cats) {
      const prior = omitYoy
        ? null
        : centsByYear(
            byCat
              .filter((r) => r.categoryId === categoryId)
              .map((r) => ({ year: r.year, month: r.month, cents: r.cents })),
            priorYear,
            months,
          );
      const currentForYoy = omitYoy
        ? null
        : centsByYear(
            byCat
              .filter((r) => r.categoryId === categoryId)
              .map((r) => ({ year: r.year, month: r.month, cents: r.cents })),
            year,
            months,
          );
      cells.push({
        year,
        categoryId,
        categoryName: v.name,
        categoryActive: v.active,
        cents: v.cents,
        shareTenths: sharePercentTenths(v.cents, yearTotal),
        yoyTenths:
          omitYoy || currentForYoy === null || prior === null
            ? null
            : ratioChangeToPercentTenths(currentForYoy, prior),
      });
    }
  }
  return cells;
}

export function seasonalityAverage(
  spend: MonthCents[],
  presence: MonthKey[],
  years: number[],
): Array<{ month: number; cents: number }> {
  const complete = years.filter((y) => isCompleteYear(presence, y));
  if (complete.length === 0) return [];
  const out: Array<{ month: number; cents: number }> = [];
  for (let month = 1; month <= 12; month++) {
    const values = complete.map(
      (year) => spend.find((r) => r.year === year && r.month === month)?.cents ?? 0,
    );
    out.push({
      month,
      cents: Number(roundHalfUpDiv(BigInt(sumCents(values)), BigInt(complete.length))),
    });
  }
  return out;
}

export function constantBasketIndexes(
  spendByCat: MonthCategoryCents[],
  baseYear: number,
  years: number[],
  topN: number,
): Array<{
  categoryId: string;
  categoryName: string;
  points: Array<{ year: number; index: number | null }>;
}> {
  const totals = new Map<string, { name: string; cents: number }>();
  for (const row of spendByCat) {
    const prev = totals.get(row.categoryId) ?? { name: row.categoryName, cents: 0 };
    prev.cents += row.cents;
    prev.name = row.categoryName;
    totals.set(row.categoryId, prev);
  }
  const top = [...totals.entries()]
    .sort((a, b) => b[1].cents - a[1].cents)
    .slice(0, topN);
  return top.map(([categoryId, meta]) => {
    const base = centsByYear(
      spendByCat
        .filter((r) => r.categoryId === categoryId)
        .map((r) => ({ year: r.year, month: r.month, cents: r.cents })),
      baseYear,
    );
    return {
      categoryId,
      categoryName: meta.name,
      points: years.map((year) => {
        const current = centsByYear(
          spendByCat
            .filter((r) => r.categoryId === categoryId)
            .map((r) => ({ year: r.year, month: r.month, cents: r.cents })),
          year,
        );
        return {
          year,
          index: base === 0 ? null : Number(roundHalfUpDiv(BigInt(current) * 100n, BigInt(base))),
        };
      }),
    };
  });
}

export function cumulativeExtraCost(
  spend: MonthCents[],
  years: number[],
  baseYear: number,
): Array<{ year: number; extraCents: number; cumulativeCents: number }> {
  const base = centsByYear(spend, baseYear);
  let running = 0;
  const out: Array<{ year: number; extraCents: number; cumulativeCents: number }> = [];
  for (const year of years) {
    if (year <= baseYear) continue;
    const extra = centsByYear(spend, year) - base;
    running += extra;
    out.push({ year, extraCents: extra, cumulativeCents: running });
  }
  return out;
}

export function compositionByCategory(
  byCat: MonthCategoryCents[],
  year: number,
): Array<{ categoryId: string; categoryName: string; categoryActive: boolean; cents: number }> {
  const map = new Map<string, { categoryName: string; categoryActive: boolean; cents: number }>();
  for (const row of byCat) {
    if (row.year !== year) continue;
    const prev = map.get(row.categoryId) ?? {
      categoryName: row.categoryName,
      categoryActive: row.categoryActive,
      cents: 0,
    };
    prev.cents += row.cents;
    prev.categoryName = row.categoryName;
    prev.categoryActive = row.categoryActive;
    map.set(row.categoryId, prev);
  }
  return [...map.entries()]
    .map(([categoryId, v]) => ({ categoryId, ...v }))
    .sort((a, b) => b.cents - a.cents);
}

export function largestCategoryShareSeries(
  byCat: MonthCategoryCents[],
  years: number[],
): Array<{ year: number; tenths: number | null; categoryName: string | null }> {
  return years.map((year) => {
    const parts = compositionByCategory(byCat, year);
    const total = sumCents(parts.map((p) => p.cents));
    const largest = parts[0];
    if (!largest) return { year, tenths: null, categoryName: null };
    return {
      year,
      tenths: sharePercentTenths(largest.cents, total),
      categoryName: largest.categoryName,
    };
  });
}

export function deficitMonthRows(
  presence: MonthKey[],
  income: MonthCents[],
  spend: MonthCents[],
  range: StatsRange,
): Array<{ year: number; month: number; incomeCents: number; spendCents: number; gapCents: number }> {
  const incMap = monthCentsMap(income);
  const spendMap = monthCentsMap(spend);
  const out: Array<{
    year: number;
    month: number;
    incomeCents: number;
    spendCents: number;
    gapCents: number;
  }> = [];
  for (const p of presence) {
    if (!inRange(p, range)) continue;
    const i = incMap.get(periodKey(p.year, p.month)) ?? 0;
    const s = spendMap.get(periodKey(p.year, p.month)) ?? 0;
    if (s > i) {
      out.push({
        year: p.year,
        month: p.month,
        incomeCents: i,
        spendCents: s,
        gapCents: s - i,
      });
    }
  }
  return out;
}

export function hccPercentTenths(
  spend: MonthCents[],
  presence: MonthKey[],
  year: number,
  priorYear: number,
  lfl: boolean,
): number | null {
  const yearIncomplete = !isCompleteYear(presence, year);
  if (yearIncomplete && !lfl) return null;
  const months = comparableMonths(presence, year, priorYear, lfl);
  const current = centsByYear(spend, year, months);
  const prior = centsByYear(spend, priorYear, months);
  return ratioChangeToPercentTenths(current, prior);
}

export function contributionsToDelta(
  spendByCat: MonthCategoryCents[],
  year: number,
  priorYear: number,
  months: number[] | undefined,
  topN: number,
): Array<{ categoryId: string; categoryName: string; deltaCents: number; other?: boolean }> {
  const allow = months ? new Set(months) : null;
  const current = new Map<string, { name: string; cents: number }>();
  const prior = new Map<string, { name: string; cents: number }>();
  for (const row of spendByCat) {
    if (allow && !allow.has(row.month)) continue;
    const target = row.year === year ? current : row.year === priorYear ? prior : null;
    if (!target) continue;
    const prev = target.get(row.categoryId) ?? { name: row.categoryName, cents: 0 };
    prev.cents += row.cents;
    prev.name = row.categoryName;
    target.set(row.categoryId, prev);
  }
  const ids = new Set([...current.keys(), ...prior.keys()]);
  const rows: Array<{ categoryId: string; categoryName: string; deltaCents: number }> = [];
  for (const id of ids) {
    const c = current.get(id)?.cents ?? 0;
    const p = prior.get(id)?.cents ?? 0;
    rows.push({
      categoryId: id,
      categoryName: current.get(id)?.name ?? prior.get(id)?.name ?? id,
      deltaCents: c - p,
    });
  }
  rows.sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents));
  const top = rows.slice(0, topN);
  const rest = rows.slice(topN);
  const otherDelta = sumCents(rest.map((r) => r.deltaCents));
  const out = top.map((r) => ({ ...r, other: false as boolean | undefined }));
  if (rest.length > 0) {
    out.push({
      categoryId: "other",
      categoryName: "Other",
      deltaCents: otherDelta,
      other: true,
    });
  }
  return out;
}

export function topCategoriesPlusOther(
  spendByCat: MonthCategoryCents[],
  topN: number,
  showAll: boolean,
): Array<{ categoryId: string; categoryName: string; cents: number; other?: boolean }> {
  const totals = new Map<string, { name: string; cents: number }>();
  for (const row of spendByCat) {
    const prev = totals.get(row.categoryId) ?? { name: row.categoryName, cents: 0 };
    prev.cents += row.cents;
    prev.name = row.categoryName;
    totals.set(row.categoryId, prev);
  }
  const rows = [...totals.entries()]
    .map(([categoryId, v]) => ({ categoryId, categoryName: v.name, cents: v.cents }))
    .sort((a, b) => b.cents - a.cents);
  if (showAll || rows.length <= topN) return rows;
  const top = rows.slice(0, topN);
  const rest = rows.slice(topN);
  return [
    ...top,
    {
      categoryId: "other",
      categoryName: "Other",
      cents: sumCents(rest.map((r) => r.cents)),
      other: true,
    },
  ];
}

export function detectSignals(input: {
  presence: MonthKey[];
  income: MonthCents[];
  spend: MonthCents[];
  remaining: MonthCents[];
  incomeByCat: MonthCategoryCents[];
  spendByCat: MonthCategoryCents[];
  range: StatsRange;
  now: Date;
}): TrendSignal[] {
  const { presence, income, spend, remaining, incomeByCat, spendByCat, range, now } = input;
  const signals: TrendSignal[] = [];
  const years = yearsInRange(presence, range);
  const completeYears = years.filter((y) => isCompleteYear(presence, y));
  const latestYear = years[years.length - 1];
  const priorYear = latestYear !== undefined ? latestYear - 1 : undefined;

  if (latestYear !== undefined && priorYear !== undefined && years.includes(priorYear)) {
    const lfl = range.lfl || !isCompleteYear(presence, latestYear);
    const months = comparableMonths(presence, latestYear, priorYear, lfl);
    const incNow = centsByYear(income, latestYear, months);
    const incPrev = centsByYear(income, priorYear, months);
    const spendNow = centsByYear(spend, latestYear, months);
    const spendPrev = centsByYear(spend, priorYear, months);
    const savNow = realizedSavings(incNow, spendNow);
    const savPrev = realizedSavings(incPrev, spendPrev);
    const rateNow = savingsRateTenths(savNow, incNow);
    const ratePrev = savingsRateTenths(savPrev, incPrev);
    if (rateNow !== null && ratePrev !== null && ratePrev - rateNow >= 50) {
      signals.push({
        id: "savingsRateDrop",
        severity: "watch",
        metrics: { dropTenths: ratePrev - rateNow, year: latestYear },
      });
    }
    const hcc = ratioChangeToPercentTenths(spendNow, spendPrev);
    const incCh = ratioChangeToPercentTenths(incNow, incPrev);
    if (hcc !== null && incCh !== null && hcc - incCh >= 30) {
      signals.push({
        id: "spendOutpacingIncome",
        severity: "watch",
        metrics: { gapTenths: hcc - incCh, year: latestYear },
      });
    }
    const cats = categoryYearTotals(spendByCat, latestYear, priorYear, months);
    for (const cat of cats) {
      const yoy = ratioChangeToPercentTenths(cat.current, cat.prior);
      if (yoy !== null) {
        if (yoy >= 250) {
          signals.push({
            id: "categorySpike",
            severity: "watch",
            categoryId: cat.categoryId,
            metrics: { yoyTenths: yoy, year: latestYear, name: cat.categoryName },
          });
        } else if (yoy >= 150 && (incCh === null || yoy > incCh)) {
          signals.push({
            id: "categoryRunaway",
            severity: "watch",
            categoryId: cat.categoryId,
            metrics: { yoyTenths: yoy, year: latestYear, name: cat.categoryName },
          });
        }
      }
      if (cat.prior === 0 && spendNow > 0 && cat.current * 100 >= spendNow * 5) {
        signals.push({
          id: "newCategoryMaterial",
          severity: "info",
          categoryId: cat.categoryId,
          metrics: {
            shareTenths: sharePercentTenths(cat.current, spendNow) ?? 0,
            year: latestYear,
            name: cat.categoryName,
          },
        });
      }
    }
    if (incNow > 0) {
      const largest = cats.reduce(
        (best, c) => (c.current > best.current ? c : best),
        { categoryId: "", categoryName: "", current: 0, prior: 0 },
      );
      if (largest.current * 100 >= incNow * 30) {
        signals.push({
          id: "housingBurden",
          severity: "watch",
          categoryId: largest.categoryId || undefined,
          metrics: {
            shareTenths: sharePercentTenths(largest.current, incNow) ?? 0,
            year: latestYear,
            name: largest.categoryName,
          },
        });
      }
    }
  }

  if (latestYear !== undefined) {
    const incYear = centsByYear(income, latestYear);
    const incomeCats = categoryYearTotals(incomeByCat, latestYear, latestYear - 1, undefined)
      .filter((c) => c.current > 0);
    if (incYear > 0 && incomeCats.length > 0) {
      const largest = incomeCats.reduce((a, b) => (a.current > b.current ? a : b));
      if (largest.current * 100 >= incYear * 85) {
        signals.push({
          id: "incomeConcentration",
          severity: "watch",
          categoryId: largest.categoryId,
          metrics: {
            shareTenths: sharePercentTenths(largest.current, incYear) ?? 0,
            year: latestYear,
            name: largest.categoryName,
          },
        });
      }
    }
    const latestComplete = completeYears[completeYears.length - 1];
    if (latestComplete !== undefined) {
      const twoAgo = latestComplete - 2;
      const twoAgoIncome = centsByYear(income, twoAgo);
      const twoAgoCats = categoryYearTotals(incomeByCat, latestComplete, twoAgo, undefined);
      for (const cat of twoAgoCats) {
        if (twoAgoIncome > 0 && cat.prior * 100 >= twoAgoIncome * 10 && cat.current === 0) {
          signals.push({
            id: "incomeSourceGone",
            severity: "watch",
            categoryId: cat.categoryId,
            metrics: { year: latestComplete, name: cat.categoryName },
          });
        }
      }
    }
  }

  const incMap = monthCentsMap(income);
  const spendMap = monthCentsMap(spend);
  const deficitMonths: string[] = [];
  for (const p of presence) {
    if (p.year < range.fromYear || p.year > range.toYear) continue;
    const i = incMap.get(periodKey(p.year, p.month)) ?? 0;
    const s = spendMap.get(periodKey(p.year, p.month)) ?? 0;
    if (s > i) deficitMonths.push(`${p.year}-${String(p.month).padStart(2, "0")}`);
  }
  if (deficitMonths.length > 0) {
    signals.push({
      id: "deficitMonth",
      severity: "risk",
      metrics: { months: deficitMonths.join(","), count: deficitMonths.length },
    });
  }
  for (const y of completeYears) {
    const savings = realizedSavings(centsByYear(income, y), centsByYear(spend, y));
    if (savings < 0) {
      signals.push({
        id: "deficitYear",
        severity: "risk",
        metrics: { year: y, savingsCents: savings },
      });
    }
  }

  for (const y of completeYears) {
    const monthly = monthsInYear(presence, y).map((m) => ({
      month: m,
      cents: monthCentsMap(spend).get(periodKey(y, m)) ?? 0,
    }));
    const yearTotal = sumCents(monthly.map((m) => m.cents));
    if (yearTotal <= 0) continue;
    const peak = monthly.reduce((a, b) => (a.cents > b.cents ? a : b));
    if (peak.cents * 120 >= yearTotal * 14) {
      signals.push({
        id: "seasonalityPeak",
        severity: "info",
        metrics: { year: y, month: peak.month },
      });
    }
  }

  const calendarYear = now.getFullYear();
  const calendarMonth = now.getMonth() + 1;
  const latestPresence = [...presence].sort(
    (a, b) => periodKey(b.year, b.month) - periodKey(a.year, a.month),
  )[0];
  if (latestPresence) {
    const rem = monthCentsMap(remaining).get(
      periodKey(latestPresence.year, latestPresence.month),
    ) ?? 0;
    if (rem > 0) {
      signals.push({
        id: "openMonthReserve",
        severity: "info",
        metrics: {
          year: latestPresence.year,
          month: latestPresence.month,
          remainingCents: rem,
        },
      });
    }
  }

  for (const y of years) {
    const count = monthsInYear(presence, y).length;
    if (count < 12 && y !== calendarYear) {
      signals.push({
        id: "sparseYear",
        severity: "info",
        metrics: { year: y, months: count },
      });
    }
  }

  if (completeYears.length >= 2) {
    const y0 = completeYears[0]!;
    const y1 = completeYears[completeYears.length - 1]!;
    const n = y1 - y0;
    if (n >= 1) {
      const cats = categoryYearTotals(spendByCat, y1, y0, undefined)
        .filter((c) => c.current > 0)
        .sort((a, b) => b.current - a.current)
        .slice(0, 5);
      const rows = cats
        .map((c) => {
          const rate = c.prior === 0 ? null : cagrPercentTenths(c.prior, c.current, n);
          return rate === null ? null : `${c.categoryId}:${rate}`;
        })
        .filter((x): x is string => x !== null);
      if (rows.length > 0) {
        signals.push({
          id: "threeYearCagr",
          severity: "info",
          metrics: { table: rows.join("|"), from: y0, to: y1 },
        });
      }
    }
  }

  void calendarMonth;
  return severitySort(signals);
}

function categoryYearTotals(
  rows: MonthCategoryCents[],
  year: number,
  priorYear: number,
  months: number[] | undefined,
): Array<{ categoryId: string; categoryName: string; current: number; prior: number }> {
  const allow = months ? new Set(months) : null;
  const map = new Map<string, { categoryName: string; current: number; prior: number }>();
  for (const row of rows) {
    if (allow && !allow.has(row.month)) continue;
    const prev = map.get(row.categoryId) ?? {
      categoryName: row.categoryName,
      current: 0,
      prior: 0,
    };
    if (row.year === year) prev.current += row.cents;
    if (row.year === priorYear) prev.prior += row.cents;
    prev.categoryName = row.categoryName;
    map.set(row.categoryId, prev);
  }
  return [...map.entries()].map(([categoryId, v]) => ({ categoryId, ...v }));
}

function severitySort(signals: TrendSignal[]): TrendSignal[] {
  const rank: Record<TrendSeverity, number> = { risk: 0, watch: 1, info: 2 };
  return [...signals].sort((a, b) => rank[a.severity] - rank[b.severity]);
}
