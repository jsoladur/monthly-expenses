import "server-only";
import { formatPercentTenths, ratioChangeToPercentTenths, sumCents } from "@/server/money";
import { loadGlobalStatsAggregates } from "@/server/repositories/global-stats";
import { getProfileSettings } from "@/server/services/settings";
import {
  applyRemainingProjection,
  centsByYear,
  comparableMonths,
  compositionByCategory,
  constantBasketIndexes,
  contributionsToDelta,
  cumulativeExtraCost,
  deficitMonthRows,
  detectSignals,
  filterByCategories,
  hccPercentTenths,
  isCompleteYear,
  largestCategoryShareSeries,
  monthlySeriesWithNulls,
  potentialSavings,
  realizedSavings,
  rolling12Series,
  savingsRateTenths,
  seasonalityAverage,
  sharePercentTenths,
  topCategoriesPlusOther,
  yearCategoryMatrix,
  yearlyTotals,
  yearsInRange,
  type MonthCategoryCents,
  type MonthCents,
  type MonthKey,
  type StatsRange,
  type TrendSignal,
} from "@/server/services/global-stats-formulas";

export type StatsTabId = "overview" | "incomes" | "expenses" | "inflation" | "trends";

export const STATS_TABS: StatsTabId[] = [
  "overview",
  "incomes",
  "expenses",
  "inflation",
  "trends",
];

export type StatsGranularity = "year" | "month";

export type GlobalStatsQueryInput = {
  tab?: string | string[];
  from?: string | string[];
  to?: string | string[];
  lfl?: string | string[];
  category?: string | string[];
  project?: string | string[];
  granularity?: string | string[];
  all?: string | string[];
};

export type GlobalStatsMeta = {
  currency: string;
  empty: boolean;
  minYear: number | null;
  maxYear: number | null;
  years: number[];
  completeYears: number[];
  range: StatsRange;
  defaultLfl: boolean;
  granularity: StatsGranularity;
  tab: StatsTabId;
  gaps: Array<{ year: number; monthCount: number }>;
  openMonth: {
    year: number;
    month: number;
    remainingCents: number;
    potentialSavingsCents: number;
  } | null;
  selectedCategoryIds: string[];
  projectRemaining: boolean;
  showAllCategories: boolean;
};

export type KpiDelta = {
  centsDelta: number | null;
  percentTenths: number | null;
};

export type OverviewDto = {
  incomeCents: number;
  spendCents: number;
  savingsCents: number;
  savingsRateTenths: number | null;
  savingsRateDeltaTenths: number | null;
  incomeDelta: KpiDelta;
  spendDelta: KpiDelta;
  snapshot: {
    fromYear: number;
    toYear: number;
    spendFromCents: number;
    spendToCents: number;
    spendPctTenths: number | null;
    incomeFromCents: number;
    incomeToCents: number;
    incomePctTenths: number | null;
    rateFromTenths: number | null;
    rateToTenths: number | null;
  } | null;
  yearlyIncome: Array<{ year: number; cents: number; complete: boolean }>;
  yearlySpend: Array<{ year: number; cents: number; complete: boolean }>;
  monthlyIncome: Array<{ year: number; month: number; cents: number | null }>;
  monthlySpend: Array<{ year: number; month: number; cents: number | null }>;
  rollingIncome: Array<{ year: number; month: number; cents: number }>;
  rollingSpend: Array<{ year: number; month: number; cents: number }>;
  savingsRateByYear: Array<{ year: number; tenths: number | null; complete: boolean }>;
  firstCompleteComposition: Array<{
    categoryId: string;
    categoryName: string;
    categoryActive: boolean;
    cents: number;
  }>;
  latestCompleteComposition: Array<{
    categoryId: string;
    categoryName: string;
    categoryActive: boolean;
    cents: number;
  }>;
  firstCompleteYear: number | null;
  latestCompleteYear: number | null;
};

export type SeriesTabDto = {
  yearly: Array<{ year: number; cents: number; complete: boolean }>;
  monthly: Array<{ year: number; month: number; cents: number | null }>;
  rolling: Array<{ year: number; month: number; cents: number }>;
  stacked: Array<{ categoryId: string; categoryName: string; categoryActive: boolean; cents: number; other?: boolean }>;
  mix: Array<{ categoryId: string; categoryName: string; categoryActive: boolean; cents: number }>;
  largestShare: Array<{ year: number; tenths: number | null; categoryName: string | null }>;
  matrix: ReturnType<typeof yearCategoryMatrix>;
  ranking: Array<{ categoryId: string; categoryName: string; categoryActive: boolean; cents: number }>;
  seasonality: Array<{ month: number; cents: number }>;
  showAll: boolean;
};

export type InflationDto = {
  disclaimer: true;
  hccByYear: Array<{
    year: number;
    tenths: number | null;
    lflMonths: number[] | null;
    complete: boolean;
  }>;
  incomeVsHcc: Array<{
    year: number;
    incomeTenths: number | null;
    hccTenths: number | null;
  }>;
  contributions: Array<{
    categoryId: string;
    categoryName: string;
    deltaCents: number;
    other?: boolean;
  }>;
  baskets: ReturnType<typeof constantBasketIndexes>;
  extraCost: ReturnType<typeof cumulativeExtraCost>;
  impact: "hccAhead" | "incomeAhead" | "tied" | null;
  largestShareBaseTenths: number | null;
  largestShareLatestTenths: number | null;
  largestCategoryName: string | null;
  baseYear: number | null;
  comparable: boolean;
};

export type TrendsDto = {
  signals: TrendSignal[];
  sparklines: Array<{
    categoryId: string;
    categoryName: string;
    points: Array<{ year: number; month: number; cents: number }>;
  }>;
  savingsRateOverlay: Array<{ year: number; savingsTenths: number | null; hccTenths: number | null }>;
  deficitMonths: ReturnType<typeof deficitMonthRows>;
  cagrRows: Array<{ categoryId: string; tenths: number }>;
};

export type GlobalStatsPage = {
  meta: GlobalStatsMeta;
  overview: OverviewDto | null;
  incomes: SeriesTabDto | null;
  expenses: SeriesTabDto | null;
  inflation: InflationDto | null;
  trends: TrendsDto | null;
};

export function parseStatsSearchParams(sp: GlobalStatsQueryInput): {
  tab: StatsTabId;
  fromYear: number | undefined;
  toYear: number | undefined;
  lfl: boolean | undefined;
  categoryIds: string[];
  projectRemaining: boolean;
  granularity: StatsGranularity;
  showAllCategories: boolean;
} {
  const tabRaw = first(sp.tab);
  const tab: StatsTabId = STATS_TABS.includes(tabRaw as StatsTabId)
    ? (tabRaw as StatsTabId)
    : "overview";
  const fromYear = parseYear(first(sp.from));
  const toYear = parseYear(first(sp.to));
  const lflRaw = first(sp.lfl);
  const lfl = lflRaw === undefined ? undefined : lflRaw !== "0";
  const categoryIds = (Array.isArray(sp.category) ? sp.category : sp.category ? [sp.category] : [])
    .filter((id) => typeof id === "string" && id.length > 0);
  const granularity: StatsGranularity = first(sp.granularity) === "month" ? "month" : "year";
  return {
    tab,
    fromYear,
    toYear,
    lfl,
    categoryIds,
    projectRemaining: first(sp.project) === "1",
    granularity,
    showAllCategories: first(sp.all) === "1",
  };
}

export async function getGlobalStatsPage(
  userId: string,
  search: GlobalStatsQueryInput,
  now: Date = new Date(),
): Promise<GlobalStatsPage> {
  const parsed = parseStatsSearchParams(search);
  const [aggregates, settings] = await Promise.all([
    loadGlobalStatsAggregates(userId),
    getProfileSettings(userId),
  ]);
  const currency = settings?.currency ?? "EUR";
  const presence = aggregates.presence;
  const empty = presence.length === 0;
  const yearsAll = [...new Set(presence.map((p) => p.year))].sort((a, b) => a - b);
  const minYear = yearsAll[0] ?? null;
  const maxYear = yearsAll[yearsAll.length - 1] ?? null;
  const fromYear = clampYear(parsed.fromYear, minYear, maxYear) ?? minYear ?? now.getFullYear();
  const toYear = clampYear(parsed.toYear, minYear, maxYear) ?? maxYear ?? now.getFullYear();
  const from = Math.min(fromYear, toYear);
  const to = Math.max(fromYear, toYear);
  const toIncomplete = !isCompleteYear(presence, to);
  const lfl = parsed.lfl ?? toIncomplete;
  const range: StatsRange = { fromYear: from, toYear: to, lfl };
  const years = yearsInRange(presence, range);
  const completeYears = years.filter((y) => isCompleteYear(presence, y));
  const gaps = years
    .map((year) => ({
      year,
      monthCount: presence.filter((p) => p.year === year).length,
    }))
    .filter((g) => g.monthCount < 12);

  const latestPresence = [...presence].sort((a, b) => a.year - b.year || a.month - b.month).at(-1) ?? null;
  const remainingLatest = latestPresence
    ? aggregates.remainingByMonth.find(
        (r) => r.year === latestPresence.year && r.month === latestPresence.month,
      )?.cents ?? 0
    : 0;
  const openMonth =
    latestPresence && remainingLatest > 0
      ? {
          year: latestPresence.year,
          month: latestPresence.month,
          remainingCents: remainingLatest,
          potentialSavingsCents: potentialSavings(
            aggregates.incomeByMonth.find(
              (r) => r.year === latestPresence.year && r.month === latestPresence.month,
            )?.cents ?? 0,
            aggregates.spendByMonth.find(
              (r) => r.year === latestPresence.year && r.month === latestPresence.month,
            )?.cents ?? 0,
            remainingLatest,
          ),
        }
      : null;

  const meta: GlobalStatsMeta = {
    currency,
    empty,
    minYear,
    maxYear,
    years: yearsAll,
    completeYears,
    range,
    defaultLfl: toIncomplete,
    granularity: parsed.granularity,
    tab: parsed.tab,
    gaps,
    openMonth,
    selectedCategoryIds: parsed.categoryIds,
    projectRemaining: parsed.projectRemaining,
    showAllCategories: parsed.showAllCategories,
  };

  if (empty) {
    return { meta, overview: null, incomes: null, expenses: null, inflation: null, trends: null };
  }

  const spendBase =
    parsed.tab === "overview" && parsed.projectRemaining && openMonth
      ? applyRemainingProjection(aggregates.spendByMonth, aggregates.remainingByMonth, {
          year: openMonth.year,
          month: openMonth.month,
        })
      : aggregates.spendByMonth;

  const income = clipSeries(aggregates.incomeByMonth, range);
  const spend = clipSeries(spendBase, range);
  const remaining = clipSeries(aggregates.remainingByMonth, range);
  const incomeByCat = filterByCategories(
    clipCategory(aggregates.incomeByCategoryMonth, range),
    parsed.categoryIds,
  );
  const spendByCat = filterByCategories(
    clipCategory(aggregates.spendByCategoryMonth, range),
    parsed.categoryIds,
  );
  const presenceInRange = presence.filter((p) => p.year >= range.fromYear && p.year <= range.toYear);

  const page: GlobalStatsPage = {
    meta,
    overview: null,
    incomes: null,
    expenses: null,
    inflation: null,
    trends: null,
  };

  if (parsed.tab === "overview") {
    page.overview = buildOverview({
      presence: presenceInRange,
      income,
      spend,
      spendByCat,
      range,
      years,
    });
  } else if (parsed.tab === "incomes") {
    page.incomes = buildSeriesTab({
      presence: presenceInRange,
      series: income,
      byCat: incomeByCat,
      range,
      years,
      lfl,
      showAll: true,
      includeSeasonality: false,
    });
  } else if (parsed.tab === "expenses") {
    page.expenses = buildSeriesTab({
      presence: presenceInRange,
      series: spend,
      byCat: spendByCat,
      range,
      years,
      lfl,
      showAll: parsed.showAllCategories,
      includeSeasonality: true,
    });
  } else if (parsed.tab === "inflation") {
    page.inflation = buildInflation({
      presence: presenceInRange,
      income,
      spend,
      spendByCat,
      range,
      years,
      completeYears,
      lfl,
    });
  } else {
    page.trends = buildTrends({
      presence: presenceInRange,
      income,
      spend,
      remaining,
      incomeByCat,
      spendByCat,
      range,
      years,
      now,
    });
  }

  return page;
}

function buildOverview(input: {
  presence: MonthKey[];
  income: MonthCents[];
  spend: MonthCents[];
  spendByCat: MonthCategoryCents[];
  range: StatsRange;
  years: number[];
}): OverviewDto {
  const { presence, income, spend, spendByCat, range, years } = input;
  const incomeCents = sumCents(income.map((r) => r.cents));
  const spendCents = sumCents(spend.map((r) => r.cents));
  const savingsCents = realizedSavings(incomeCents, spendCents);
  const latest = years[years.length - 1];
  const prior = latest !== undefined && years.includes(latest - 1) ? latest - 1 : undefined;
  const months = prior !== undefined ? comparableMonths(presence, latest!, prior, range.lfl) : undefined;
  const incomeDelta: KpiDelta = { centsDelta: null, percentTenths: null };
  const spendDelta: KpiDelta = { centsDelta: null, percentTenths: null };
  let savingsRateDeltaTenths: number | null = null;
  if (latest !== undefined && prior !== undefined) {
    const incNow = centsByYear(income, latest, months);
    const incPrev = centsByYear(income, prior, months);
    const spendNow = centsByYear(spend, latest, months);
    const spendPrev = centsByYear(spend, prior, months);
    incomeDelta.centsDelta = incNow - incPrev;
    incomeDelta.percentTenths = ratioChangeToPercentTenths(incNow, incPrev);
    spendDelta.centsDelta = spendNow - spendPrev;
    spendDelta.percentTenths = ratioChangeToPercentTenths(spendNow, spendPrev);
    const rateNow = savingsRateTenths(realizedSavings(incNow, spendNow), incNow);
    const ratePrev = savingsRateTenths(realizedSavings(incPrev, spendPrev), incPrev);
    if (rateNow !== null && ratePrev !== null) {
      savingsRateDeltaTenths = rateNow - ratePrev;
    }
  }

  const firstYear = years[0];
  const lastYear = years[years.length - 1];
  let snapshot: OverviewDto["snapshot"] = null;
  if (firstYear !== undefined && lastYear !== undefined) {
    const spendFrom = centsByYear(spend, firstYear);
    const spendTo = centsByYear(spend, lastYear);
    const incFrom = centsByYear(income, firstYear);
    const incTo = centsByYear(income, lastYear);
    snapshot = {
      fromYear: firstYear,
      toYear: lastYear,
      spendFromCents: spendFrom,
      spendToCents: spendTo,
      spendPctTenths: ratioChangeToPercentTenths(spendTo, spendFrom),
      incomeFromCents: incFrom,
      incomeToCents: incTo,
      incomePctTenths: ratioChangeToPercentTenths(incTo, incFrom),
      rateFromTenths: savingsRateTenths(realizedSavings(incFrom, spendFrom), incFrom),
      rateToTenths: savingsRateTenths(realizedSavings(incTo, spendTo), incTo),
    };
  }

  const completeYears = years.filter((y) => isCompleteYear(presence, y));
  const firstCompleteYear = completeYears[0] ?? null;
  const latestCompleteYear = completeYears[completeYears.length - 1] ?? null;

  return {
    incomeCents,
    spendCents,
    savingsCents,
    savingsRateTenths: savingsRateTenths(savingsCents, incomeCents),
    savingsRateDeltaTenths,
    incomeDelta,
    spendDelta,
    snapshot,
    yearlyIncome: yearlyTotals(income, years).map((r) => ({
      ...r,
      complete: isCompleteYear(presence, r.year),
    })),
    yearlySpend: yearlyTotals(spend, years).map((r) => ({
      ...r,
      complete: isCompleteYear(presence, r.year),
    })),
    monthlyIncome: monthlySeriesWithNulls(presence, income, range.fromYear, range.toYear),
    monthlySpend: monthlySeriesWithNulls(presence, spend, range.fromYear, range.toYear),
    rollingIncome: rolling12Series(presence, income),
    rollingSpend: rolling12Series(presence, spend),
    savingsRateByYear: years.map((year) => {
      const inc = centsByYear(income, year);
      const sav = realizedSavings(inc, centsByYear(spend, year));
      return { year, tenths: savingsRateTenths(sav, inc), complete: isCompleteYear(presence, year) };
    }),
    firstCompleteComposition: firstCompleteYear
      ? compositionByCategory(spendByCat, firstCompleteYear)
      : [],
    latestCompleteComposition: latestCompleteYear
      ? compositionByCategory(spendByCat, latestCompleteYear)
      : [],
    firstCompleteYear,
    latestCompleteYear,
  };
}

function buildSeriesTab(input: {
  presence: MonthKey[];
  series: MonthCents[];
  byCat: MonthCategoryCents[];
  range: StatsRange;
  years: number[];
  lfl: boolean;
  showAll: boolean;
  includeSeasonality: boolean;
}): SeriesTabDto {
  const { presence, series, byCat, range, years, lfl, showAll, includeSeasonality } = input;
  const mix = compositionTotals(byCat);
  return {
    yearly: yearlyTotals(series, years).map((r) => ({
      ...r,
      complete: isCompleteYear(presence, r.year),
    })),
    monthly: monthlySeriesWithNulls(presence, series, range.fromYear, range.toYear),
    rolling: rolling12Series(presence, series),
    stacked: topCategoriesPlusOther(byCat, 8, showAll).map((r) => {
      const sample = byCat.find((c) => c.categoryId === r.categoryId);
      return { ...r, categoryActive: sample?.categoryActive ?? true };
    }),
    mix,
    largestShare: largestCategoryShareSeries(byCat, years),
    matrix: yearCategoryMatrix(byCat, presence, years, lfl),
    ranking: mix,
    seasonality: includeSeasonality ? seasonalityAverage(series, presence, years) : [],
    showAll,
  };
}

function buildInflation(input: {
  presence: MonthKey[];
  income: MonthCents[];
  spend: MonthCents[];
  spendByCat: MonthCategoryCents[];
  range: StatsRange;
  years: number[];
  completeYears: number[];
  lfl: boolean;
}): InflationDto {
  const { presence, income, spend, spendByCat, years, completeYears, lfl } = input;
  const hccByYear = years.map((year) => {
    const prior = year - 1;
    const tenths = years.includes(prior)
      ? hccPercentTenths(spend, presence, year, prior, lfl)
      : null;
    const months =
      years.includes(prior) && (!isCompleteYear(presence, year) || !isCompleteYear(presence, prior)) && lfl
        ? comparableMonths(presence, year, prior, lfl) ?? null
        : null;
    return { year, tenths, lflMonths: months, complete: isCompleteYear(presence, year) };
  });
  const incomeVsHcc = years.map((year) => {
    const prior = year - 1;
    if (!years.includes(prior)) {
      return { year, incomeTenths: null, hccTenths: null };
    }
    const incomplete = !isCompleteYear(presence, year);
    if (incomplete && !lfl) {
      return { year, incomeTenths: null, hccTenths: null };
    }
    const months = comparableMonths(presence, year, prior, lfl);
    return {
      year,
      incomeTenths: ratioChangeToPercentTenths(
        centsByYear(income, year, months),
        centsByYear(income, prior, months),
      ),
      hccTenths: hccPercentTenths(spend, presence, year, prior, lfl),
    };
  });
  const comparablePairs = incomeVsHcc.filter((r) => r.hccTenths !== null);
  const latest = comparablePairs[comparablePairs.length - 1];
  let impact: InflationDto["impact"] = null;
  if (latest && latest.hccTenths !== null && latest.incomeTenths !== null) {
    if (latest.hccTenths > latest.incomeTenths) impact = "hccAhead";
    else if (latest.incomeTenths > latest.hccTenths) impact = "incomeAhead";
    else impact = "tied";
  }
  const lastYear = years[years.length - 1];
  const priorYear = lastYear !== undefined ? lastYear - 1 : undefined;
  const contribMonths =
    lastYear !== undefined && priorYear !== undefined && years.includes(priorYear)
      ? comparableMonths(presence, lastYear, priorYear, lfl)
      : undefined;
  const contributions =
    lastYear !== undefined && priorYear !== undefined && years.includes(priorYear)
      ? contributionsToDelta(spendByCat, lastYear, priorYear, contribMonths, 10)
      : [];
  const baseYear = completeYears[0] ?? null;
  const firstComplete = completeYears[0];
  const latestComplete = completeYears[completeYears.length - 1];
  let largestShareBaseTenths: number | null = null;
  let largestShareLatestTenths: number | null = null;
  let largestCategoryName: string | null = null;
  if (latestComplete !== undefined) {
    const mix = compositionByCategory(spendByCat, latestComplete);
    const largest = mix[0];
    const inc = centsByYear(income, latestComplete);
    if (largest) {
      largestCategoryName = largest.categoryName;
      largestShareLatestTenths = sharePercentTenths(largest.cents, inc);
      if (firstComplete !== undefined) {
        const baseAmt = spendByCat
          .filter((r) => r.year === firstComplete && r.categoryId === largest.categoryId)
          .reduce((acc, r) => acc + r.cents, 0);
        largestShareBaseTenths = sharePercentTenths(baseAmt, centsByYear(income, firstComplete));
      }
    }
  }
  return {
    disclaimer: true,
    hccByYear,
    incomeVsHcc,
    contributions,
    baskets: baseYear ? constantBasketIndexes(spendByCat, baseYear, years, 6) : [],
    extraCost: baseYear ? cumulativeExtraCost(spend, years, baseYear) : [],
    impact,
    largestShareBaseTenths,
    largestShareLatestTenths,
    largestCategoryName,
    baseYear,
    comparable: comparablePairs.length > 0,
  };
}

function buildTrends(input: {
  presence: MonthKey[];
  income: MonthCents[];
  spend: MonthCents[];
  remaining: MonthCents[];
  incomeByCat: MonthCategoryCents[];
  spendByCat: MonthCategoryCents[];
  range: StatsRange;
  years: number[];
  now: Date;
}): TrendsDto {
  const { presence, income, spend, remaining, incomeByCat, spendByCat, range, years, now } = input;
  const signals = detectSignals({
    presence,
    income,
    spend,
    remaining,
    incomeByCat,
    spendByCat,
    range,
    now,
  });
  const top = topCategoriesPlusOther(spendByCat, 6, false).filter((c) => !c.other);
  const sparklines = top.map((cat) => {
    const series = spendByCat
      .filter((r) => r.categoryId === cat.categoryId)
      .map((r) => ({ year: r.year, month: r.month, cents: r.cents }));
    return {
      categoryId: cat.categoryId,
      categoryName: cat.categoryName,
      points: rolling12Series(presence, series),
    };
  });
  const savingsRateOverlay = years.map((year) => {
    const prior = year - 1;
    const inc = centsByYear(income, year);
    const sav = realizedSavings(inc, centsByYear(spend, year));
    return {
      year,
      savingsTenths: savingsRateTenths(sav, inc),
      hccTenths: years.includes(prior)
        ? hccPercentTenths(spend, presence, year, prior, range.lfl)
        : null,
    };
  });
  const cagrSignal = signals.find((s) => s.id === "threeYearCagr");
  const cagrRows: TrendsDto["cagrRows"] = [];
  if (cagrSignal && typeof cagrSignal.metrics.table === "string") {
    for (const part of cagrSignal.metrics.table.split("|")) {
      const [categoryId, tenthsRaw] = part.split(":");
      const tenths = Number(tenthsRaw);
      if (categoryId && Number.isInteger(tenths)) {
        cagrRows.push({ categoryId, tenths });
      }
    }
  }
  return {
    signals,
    sparklines,
    savingsRateOverlay,
    deficitMonths: deficitMonthRows(presence, income, spend, range),
    cagrRows,
  };
}

function compositionTotals(
  byCat: MonthCategoryCents[],
): Array<{ categoryId: string; categoryName: string; categoryActive: boolean; cents: number }> {
  const map = new Map<string, { categoryName: string; categoryActive: boolean; cents: number }>();
  for (const row of byCat) {
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

function clipSeries(series: MonthCents[], range: StatsRange): MonthCents[] {
  return series.filter((r) => r.year >= range.fromYear && r.year <= range.toYear);
}

function clipCategory(series: MonthCategoryCents[], range: StatsRange): MonthCategoryCents[] {
  return series.filter((r) => r.year >= range.fromYear && r.year <= range.toYear);
}

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function parseYear(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1970 || n > 9999) return undefined;
  return n;
}

function clampYear(
  value: number | undefined,
  min: number | null,
  max: number | null,
): number | undefined {
  if (value === undefined) return undefined;
  let n = value;
  if (min !== null) n = Math.max(n, min);
  if (max !== null) n = Math.min(n, max);
  return n;
}

export { formatPercentTenths };
