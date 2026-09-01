"use client";

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatAxisCents, formatMoney, isAppLocale, monthName, monthYear } from "@/i18n/format";
import { formatPercentTenths } from "@/server/money";
import type { GlobalStatsPage, KpiDelta, StatsTabId } from "@/server/services/global-stats";
import type { TrendSeverity, TrendSignal } from "@/server/services/global-stats-formulas";
import { Collapsible } from "@/components/ui/collapsible";
import {
  ChartTooltip,
  CHART_LEGEND_WRAPPER,
  CHART_TOOLTIP_WRAPPER,
} from "@/components/chart-tooltip";
import {
  CHART_COLORS,
  StatsChartBlock,
  StatsDataTable,
} from "@/app/[locale]/stats/stats-chart-block";
import { StatsGlossary } from "@/components/stats-glossary";
import {
  Activity,
  CircleHelp,
  LayoutDashboard,
  Percent,
  Receipt,
  Wallet,
  type LucideIcon,
} from "lucide-react";

const TABS: StatsTabId[] = ["overview", "trends", "inflation", "expenses", "incomes", "help"];

const STATS_TAB_ICONS: Record<StatsTabId, LucideIcon> = {
  overview: LayoutDashboard,
  trends: Activity,
  inflation: Percent,
  expenses: Receipt,
  incomes: Wallet,
  help: CircleHelp,
};

const INCOME_COLOR = "hsl(var(--income))";
const SPEND_COLOR = "hsl(var(--chart-1))";

type ViewState = {
  tab: StatsTabId;
  from: number;
  to: number;
  lfl: boolean;
  categoryIds: string[];
  project: boolean;
  granularity: "year" | "month";
  all: boolean;
};

function statsPath(state: ViewState): string {
  const q = new URLSearchParams();
  if (state.tab !== "overview") q.set("tab", state.tab);
  q.set("from", String(state.from));
  q.set("to", String(state.to));
  q.set("lfl", state.lfl ? "1" : "0");
  if (state.granularity === "month") q.set("granularity", "month");
  if (state.project) q.set("project", "1");
  if (state.all) q.set("all", "1");
  for (const id of state.categoryIds) q.append("category", id);
  const qs = q.toString();
  return qs ? `/stats?${qs}` : "/stats";
}

function pct(tenths: number | null | undefined): string {
  if (tenths === null || tenths === undefined) return "—";
  return `${formatPercentTenths(tenths)}%`;
}

function signedPct(tenths: number): string {
  const formatted = pct(tenths);
  return tenths > 0 ? `+${formatted}` : formatted;
}

function vsPriorCaption(
  label: string,
  delta: KpiDelta,
  money: (cents: number) => string,
): ReactNode {
  if (delta.centsDelta === null && delta.percentTenths === null) return undefined;
  const amount = delta.centsDelta === null ? "—" : money(delta.centsDelta);
  return (
    <>
      {label}:{" "}
      <span className="whitespace-nowrap tabular-nums">
        {amount} ({pct(delta.percentTenths)})
      </span>
    </>
  );
}

function moneyTick(value: unknown): string {
  return formatAxisCents(typeof value === "number" ? value : Number(value));
}

function percentTick(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? `${n.toFixed(0)}%` : "";
}

function formatPercentPoint(value: number): string {
  return `${value.toFixed(1)}%`;
}

function moneyTooltipEl(money: (cents: number) => string) {
  return (
    <Tooltip
      content={<ChartTooltip formatValue={money} />}
      wrapperStyle={CHART_TOOLTIP_WRAPPER}
      allowEscapeViewBox={{ x: true, y: true }}
    />
  );
}

function sparklineTooltipEl(
  money: (cents: number) => string,
  rollingLabel: string,
  monthLabel: string,
) {
  return (
    <Tooltip
      content={<SparklineTooltip money={money} rollingLabel={rollingLabel} monthLabel={monthLabel} />}
      wrapperStyle={CHART_TOOLTIP_WRAPPER}
      allowEscapeViewBox={{ x: true, y: true }}
    />
  );
}

function SparklineTooltip({
  active,
  payload,
  money,
  rollingLabel,
  monthLabel,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{
    payload?: { period?: string; cents?: number; monthCents?: number };
  }>;
  money: (cents: number) => string;
  rollingLabel: string;
  monthLabel: string;
}) {
  if (!active || !payload?.[0]?.payload) return null;
  const row = payload[0].payload;
  if (typeof row.cents !== "number") return null;
  return (
    <div className="bg-card text-card-foreground border-border relative z-50 min-w-[10rem] rounded-lg border px-3 py-2 shadow-sm">
      {row.period ? <p className="mb-1.5 text-xs font-medium">{row.period}</p> : null}
      <ul className="flex flex-col gap-1 text-xs">
        <li className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground">{rollingLabel}</span>
          <span className="amount shrink-0 tabular-nums">{money(row.cents)}</span>
        </li>
        {typeof row.monthCents === "number" ? (
          <li className="flex items-baseline justify-between gap-3">
            <span className="text-muted-foreground">{monthLabel}</span>
            <span className="amount shrink-0 tabular-nums">{money(row.monthCents)}</span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function percentTooltipEl() {
  return (
    <Tooltip
      content={<ChartTooltip formatValue={formatPercentPoint} />}
      wrapperStyle={CHART_TOOLTIP_WRAPPER}
      allowEscapeViewBox={{ x: true, y: true }}
    />
  );
}

export function GlobalStatsScreen({ page }: { page: GlobalStatsPage }) {
  const t = useTranslations("stats");
  const localeRaw = useLocale();
  const locale = isAppLocale(localeRaw) ? localeRaw : "en";
  const router = useRouter();
  const { meta } = page;

  const state: ViewState = {
    tab: meta.tab,
    from: meta.range.fromYear,
    to: meta.range.toYear,
    lfl: meta.range.lfl,
    categoryIds: meta.selectedCategoryIds,
    project: meta.projectRemaining,
    granularity: meta.granularity,
    all: meta.showAllCategories,
  };

  if (meta.empty) {
    return (
      <div className="flex flex-col gap-6">
        <StatsTabStrip state={state} active={meta.tab} />
        {meta.tab === "help" ? (
          <HelpTab />
        ) : (
          <section
            data-testid="stats-empty"
            className="bg-card text-card-foreground flex flex-col gap-4 rounded-lg border p-6"
          >
            <h2 className="text-lg font-semibold">{t("empty.title")}</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">{t("empty.body")}</p>
            <Link
              href="/"
              className="bg-primary text-primary-foreground inline-flex min-h-11 w-fit items-center rounded-lg px-4 text-sm font-medium"
            >
              {t("empty.cta")}
            </Link>
          </section>
        )}
      </div>
    );
  }

  const money = (cents: number) => formatMoney(cents, meta.currency);
  const go = (patch: Partial<ViewState>) => router.replace(statsPath({ ...state, ...patch }));

  const yearOptions = meta.years;

  return (
    <div className="flex flex-col gap-6">
      {meta.tab !== "help" && (
      <div className="bg-card border-border sticky top-0 z-20 flex flex-col gap-3 rounded-lg border p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">{t("filters.from")}</span>
            <select
              data-testid="stats-from"
              className="border-border bg-background min-h-11 rounded-lg border px-2 text-sm"
              value={state.from}
              onChange={(e) => go({ from: Number(e.target.value) })}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">{t("filters.to")}</span>
            <select
              data-testid="stats-to"
              className="border-border bg-background min-h-11 rounded-lg border px-2 text-sm"
              value={state.to}
              onChange={(e) => go({ to: Number(e.target.value) })}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">{t("filters.granularity")}</span>
            <select
              className="border-border bg-background min-h-11 rounded-lg border px-2 text-sm"
              value={state.granularity}
              onChange={(e) => go({ granularity: e.target.value === "month" ? "month" : "year" })}
            >
              <option value="year">{t("filters.year")}</option>
              <option value="month">{t("filters.month")}</option>
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={state.lfl}
              onChange={(e) => go({ lfl: e.target.checked })}
            />
            {t("filters.lfl")}
          </label>
          {meta.tab === "overview" && meta.openMonth && (
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={state.project}
                onChange={(e) => go({ project: e.target.checked })}
              />
              {t("filters.projectRemaining")}
            </label>
          )}
          {meta.tab === "expenses" && (
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={state.all}
                onChange={(e) => go({ all: e.target.checked })}
              />
              {t("filters.showAll")}
            </label>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {meta.gaps.map((g) => (
            <span key={g.year} className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
              {t("incompleteYear", { year: g.year, n: g.monthCount })}
            </span>
          ))}
          {meta.gaps.some((g) => g.year === meta.range.toYear) && (
            <span data-testid="stats-ytd" className="bg-secondary text-secondary-foreground rounded-full px-2 py-0.5 text-xs">
              {t("ytd")}
            </span>
          )}
          {state.lfl && (
            <span data-testid="stats-lfl" className="bg-secondary text-secondary-foreground rounded-full px-2 py-0.5 text-xs">
              {t("lfl")}
            </span>
          )}
        </div>
      </div>
      )}

      {meta.tab !== "help" && meta.openMonth && (
        <p className="bg-secondary text-secondary-foreground rounded-lg px-4 py-3 text-sm leading-relaxed">
          {t("openMonthNote", {
            monthYear: monthYear(locale, meta.openMonth.year, meta.openMonth.month),
            amount: money(meta.openMonth.remainingCents),
          })}
        </p>
      )}

      <StatsTabStrip state={state} active={meta.tab} />

      {meta.tab === "overview" && page.overview && (
        <OverviewTab
          page={page}
          money={money}
          locale={locale}
          granularity={state.granularity}
          tableLabel={t("a11y.tableToggle")}
        />
      )}
      {meta.tab === "incomes" && page.incomes && (
        <SeriesTab
          kind="incomes"
          dto={page.incomes}
          money={money}
          locale={locale}
          granularity={state.granularity}
          tableLabel={t("a11y.tableToggle")}
          currency={meta.currency}
          onDrill={(id) => go({ categoryIds: [id] })}
        />
      )}
      {meta.tab === "expenses" && page.expenses && (
        <SeriesTab
          kind="expenses"
          dto={page.expenses}
          money={money}
          locale={locale}
          granularity={state.granularity}
          tableLabel={t("a11y.tableToggle")}
          currency={meta.currency}
          onDrill={(id) => go({ categoryIds: [id] })}
        />
      )}
      {meta.tab === "inflation" && page.inflation && (
        <InflationTab
          dto={page.inflation}
          money={money}
          tableLabel={t("a11y.tableToggle")}
        />
      )}
      {meta.tab === "trends" && page.trends && (
        <TrendsTab
          dto={page.trends}
          money={money}
          locale={locale}
          tableLabel={t("a11y.tableToggle")}
        />
      )}
      {meta.tab === "help" && <HelpTab />}
    </div>
  );
}

function StatsTabStrip({ state, active }: { state: ViewState; active: StatsTabId }) {
  const t = useTranslations("stats");
  return (
    <div
      className="border-border flex gap-1 overflow-x-auto border-b"
      role="tablist"
      aria-label={t("a11y.tabs")}
    >
      {TABS.map((tab) => {
        const Icon = STATS_TAB_ICONS[tab];
        return (
        <Link
          key={tab}
          href={statsPath({ ...state, tab })}
          role="tab"
          aria-selected={active === tab}
          className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${
            active === tab
              ? "border-primary text-primary"
              : "text-muted-foreground hover:text-foreground border-transparent"
          }`}
        >
          <Icon className="size-3.5 shrink-0" aria-hidden />
          {t(`tabs.${tab}`)}
        </Link>
        );
      })}
    </div>
  );
}

function HelpTab() {
  const t = useTranslations("stats");
  return (
    <StatsGlossary
      title={t("help.title")}
      intro={t("help.intro")}
      groups={[
        {
          heading: t("glossary.groups.filters"),
          items: [
            { term: t("glossary.lfl.term"), definition: t("glossary.lfl.def") },
            { term: t("glossary.project.term"), definition: t("glossary.project.def") },
          ],
        },
        {
          heading: t("glossary.groups.money"),
          items: [
            { term: t("glossary.income.term"), definition: t("glossary.income.def") },
            { term: t("glossary.spend.term"), definition: t("glossary.spend.def") },
            { term: t("glossary.savings.term"), definition: t("glossary.savings.def") },
            { term: t("glossary.savingsRate.term"), definition: t("glossary.savingsRate.def") },
          ],
        },
        {
          heading: t("glossary.groups.compare"),
          items: [
            {
              term: t("glossary.hcc.term"),
              definition: t("glossary.hcc.def"),
              testId: "stats-hcc-legend",
            },
            {
              term: t("glossary.notCpi.term"),
              definition: t("glossary.notCpi.def"),
              testId: "stats-inflation-disclaimer",
            },
            { term: t("glossary.ytd.term"), definition: t("glossary.ytd.def") },
            { term: t("glossary.rolling.term"), definition: t("glossary.rolling.def") },
            { term: t("glossary.cagr.term"), definition: t("glossary.cagr.def") },
          ],
        },
      ]}
    />
  );
}

function OverviewTab({
  page,
  money,
  locale,
  granularity,
  tableLabel,
}: {
  page: GlobalStatsPage;
  money: (cents: number) => string;
  locale: "en" | "es";
  granularity: "year" | "month";
  tableLabel: string;
}) {
  const t = useTranslations("stats");
  const o = page.overview!;
  const negative = o.savingsCents < 0;
  const composed = granularity === "month"
    ? o.monthlySpend.map((row, i) => ({
        label: row.cents === null ? `${row.year}-${row.month}` : `${row.year}-${String(row.month).padStart(2, "0")}`,
        spend: row.cents,
        income: o.monthlyIncome[i]?.cents ?? null,
      }))
    : o.yearlySpend.map((row, i) => ({
        label: String(row.year),
        spend: row.cents,
        income: o.yearlyIncome[i]?.cents ?? 0,
        complete: row.complete,
      }));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          testId="stats-kpi-income"
          label={t("kpis.income")}
          value={money(o.incomeCents)}
          caption={vsPriorCaption(t("kpis.vsPrior"), o.incomeDelta, money)}
        />
        <KpiCard
          testId="stats-kpi-spend"
          label={t("kpis.spend")}
          value={money(o.spendCents)}
          caption={vsPriorCaption(t("kpis.vsPrior"), o.spendDelta, money)}
        />
        <KpiCard
          testId="stats-kpi-savings"
          label={t("kpis.savings")}
          value={money(o.savingsCents)}
          caption={o.savingsRateTenths === null ? t("kpis.rateHidden") : pct(o.savingsRateTenths)}
          hero
          negative={negative}
        />
        <KpiCard
          testId="stats-kpi-rate"
          label={t("kpis.savingsRate")}
          value={o.savingsRateTenths === null ? "—" : pct(o.savingsRateTenths)}
          caption={o.savingsRateDeltaTenths === null ? undefined : pct(o.savingsRateDeltaTenths)}
          warn={o.savingsRateDeltaTenths !== null && o.savingsRateDeltaTenths <= -50}
        />
      </div>
      {o.snapshot && (
        <div className="flex flex-col gap-1 text-sm leading-relaxed" data-testid="stats-snapshot">
          <p className="text-muted-foreground text-xs font-medium">
            {t("overview.snapshotRange", {
              from: o.snapshot.fromYear,
              to: o.snapshot.toYear,
            })}
          </p>
          <p>
            {t("overview.snapshotSpend", {
              spendFrom: money(o.snapshot.spendFromCents),
              spendTo: money(o.snapshot.spendToCents),
              spendPct: pct(o.snapshot.spendPctTenths),
            })}
          </p>
          <p>
            {t("overview.snapshotIncome", {
              incFrom: money(o.snapshot.incomeFromCents),
              incTo: money(o.snapshot.incomeToCents),
              incPct: pct(o.snapshot.incomePctTenths),
            })}
          </p>
          <p>
            {t("overview.snapshotRate", {
              rateFrom: pct(o.snapshot.rateFromTenths),
              rateTo: pct(o.snapshot.rateToTenths),
            })}
          </p>
        </div>
      )}

      <StatsChartBlock
        testId="chart-income-vs-spend"
        title={t("charts.incomeVsSpend.title")}
        help={t("charts.incomeVsSpend.help")}
        tableLabel={tableLabel}
        table={
          <StatsDataTable
            headers={[t("a11y.period"), t("kpis.income"), t("kpis.spend")]}
            rows={composed.map((r) => [
              r.label,
              r.income === null ? "—" : money(r.income),
              r.spend === null ? "—" : money(r.spend),
            ])}
          />
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={composed}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={52} tickFormatter={moneyTick} />
            <Legend wrapperStyle={CHART_LEGEND_WRAPPER} />
            {moneyTooltipEl(money)}
            <Bar dataKey="spend" name={t("kpis.spend")} fill={SPEND_COLOR} />
            <Line dataKey="income" name={t("kpis.income")} stroke={INCOME_COLOR} dot={false} connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </StatsChartBlock>

      <StatsChartBlock
        testId="chart-rolling"
        title={t("charts.rolling.title")}
        help={t("charts.rolling.help")}
        tableLabel={tableLabel}
        table={
          <StatsDataTable
            headers={[t("a11y.period"), t("kpis.income"), t("kpis.spend")]}
            rows={o.rollingSpend.map((r, i) => [
              `${r.year}-${String(r.month).padStart(2, "0")}`,
              money(o.rollingIncome[i]?.cents ?? 0),
              money(r.cents),
            ])}
          />
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={o.rollingSpend.map((r, i) => ({
              label: `${r.year}-${String(r.month).padStart(2, "0")}`,
              spend: r.cents,
              income: o.rollingIncome[i]?.cents ?? 0,
            }))}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={52} tickFormatter={moneyTick} />
            <Legend wrapperStyle={CHART_LEGEND_WRAPPER} />
            {moneyTooltipEl(money)}
            <Line dataKey="income" name={t("kpis.income")} stroke={INCOME_COLOR} dot={false} />
            <Line dataKey="spend" name={t("kpis.spend")} stroke={SPEND_COLOR} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </StatsChartBlock>

      <StatsChartBlock
        testId="chart-savings-rate"
        title={t("charts.savingsRate.title")}
        help={t("charts.savingsRate.help")}
        tableLabel={tableLabel}
        table={
          <StatsDataTable
            headers={[t("a11y.period"), t("kpis.savingsRate")]}
            rows={o.savingsRateByYear.map((r) => [String(r.year), pct(r.tenths)])}
          />
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={o.savingsRateByYear.map((r) => ({ year: r.year, rate: r.tenths === null ? null : r.tenths / 10 }))}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="year" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={40} tickFormatter={percentTick} />
            {percentTooltipEl()}
            <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
            <Bar dataKey="rate" name={t("kpis.savingsRate")} fill="hsl(var(--chart-2))" />
          </BarChart>
        </ResponsiveContainer>
      </StatsChartBlock>

      <div className="grid gap-4 md:grid-cols-2">
        <DonutBlock
          title={t("charts.compositionFirst.title")}
          help={t("charts.compositionFirst.help")}
          tableLabel={tableLabel}
          testId="chart-composition-first"
          rows={o.firstCompleteComposition}
          money={money}
          year={o.firstCompleteYear}
        />
        <DonutBlock
          title={t("charts.compositionLatest.title")}
          help={t("charts.compositionLatest.help")}
          tableLabel={tableLabel}
          testId="chart-composition-latest"
          rows={o.latestCompleteComposition}
          money={money}
          year={o.latestCompleteYear}
        />
      </div>
      <span className="sr-only">{locale}</span>
    </div>
  );
}

function SeriesTab({
  kind,
  dto,
  money,
  locale,
  granularity,
  tableLabel,
  currency,
  onDrill,
}: {
  kind: "incomes" | "expenses";
  dto: NonNullable<GlobalStatsPage["incomes"]>;
  money: (cents: number) => string;
  locale: "en" | "es";
  granularity: "year" | "month";
  tableLabel: string;
  currency: string;
  onDrill: (id: string) => void;
}) {
  const t = useTranslations("stats");
  const tInactive = t("inactive");
  const yearlyData = dto.yearly.map((r) => ({
    label: String(r.year),
    cents: r.cents,
    complete: r.complete,
  }));
  const monthlyData = dto.monthly.map((r) => ({
    label: `${r.year}-${String(r.month).padStart(2, "0")}`,
    cents: r.cents,
  }));
  const chartData = granularity === "month" ? monthlyData : yearlyData;
  const stackedYears = [...new Set(dto.matrix.map((c) => c.year))].sort((a, b) => a - b);
  const stackedCats = dto.stacked.filter((c) => !c.other).slice(0, 8);
  const stackedData = stackedYears.map((year) => {
    const row: Record<string, number | string> = { year: String(year) };
    for (const cat of stackedCats) {
      row[cat.categoryId] = dto.matrix
        .filter((m) => m.year === year && m.categoryId === cat.categoryId)
        .reduce((acc, m) => acc + m.cents, 0);
    }
    return row;
  });

  return (
    <div className="flex flex-col gap-6">
      {kind === "incomes" && (
        <p className="bg-secondary text-secondary-foreground rounded-lg px-4 py-3 text-sm leading-relaxed">
          {t("incomes.netNote")}
        </p>
      )}
      <StatsChartBlock
        testId={`chart-${kind}-yearly`}
        title={t("charts.yearly.title")}
        help={t("charts.yearly.help")}
        tableLabel={tableLabel}
        table={
          <StatsDataTable
            headers={[t("a11y.period"), t("a11y.amount")]}
            rows={yearlyData.map((r) => [r.label, money(r.cents)])}
          />
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={yearlyData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={52} tickFormatter={moneyTick} />
            {moneyTooltipEl(money)}
            <Bar
              dataKey="cents"
              name={kind === "incomes" ? t("kpis.income") : t("kpis.spend")}
              fill={kind === "incomes" ? INCOME_COLOR : SPEND_COLOR}
            />
          </BarChart>
        </ResponsiveContainer>
      </StatsChartBlock>

      <StatsChartBlock
        testId={`chart-${kind}-monthly`}
        title={t("charts.monthly.title")}
        help={t("charts.monthly.help")}
        tableLabel={tableLabel}
        table={
          <StatsDataTable
            headers={[t("a11y.period"), t("a11y.amount")]}
            rows={monthlyData.map((r) => [r.label, r.cents === null ? "—" : money(r.cents)])}
          />
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={52} tickFormatter={moneyTick} />
            {moneyTooltipEl(money)}
            <Line
              dataKey="cents"
              name={kind === "incomes" ? t("kpis.income") : t("kpis.spend")}
              stroke={kind === "incomes" ? INCOME_COLOR : SPEND_COLOR}
              dot={false}
              connectNulls={false}
            />
            {kind === "expenses" && dto.rolling.length > 0 && granularity === "month" ? (
              <Line
                data={dto.rolling.map((r) => ({
                  label: `${r.year}-${String(r.month).padStart(2, "0")}`,
                  rolling: r.cents,
                }))}
                name={t("charts.rolling.title")}
                dataKey="rolling"
                stroke="hsl(var(--chart-3))"
                dot={false}
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </StatsChartBlock>

      <StatsChartBlock
        testId={`chart-${kind}-stacked`}
        title={t("charts.stacked.title")}
        help={t("charts.stacked.help")}
        tableLabel={tableLabel}
        table={
          <StatsDataTable
            headers={[t("a11y.period"), ...stackedCats.map((c) => c.categoryName)]}
            rows={stackedData.map((r) => [
              String(r.year),
              ...stackedCats.map((c) => money(Number(r[c.categoryId] ?? 0))),
            ])}
          />
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={stackedData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="year" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={52} tickFormatter={moneyTick} />
            {moneyTooltipEl(money)}
            <Legend wrapperStyle={CHART_LEGEND_WRAPPER} />
            {stackedCats.map((c, i) => (
              <Bar
                key={c.categoryId}
                dataKey={c.categoryId}
                name={c.categoryActive ? c.categoryName : `${c.categoryName} (${tInactive})`}
                stackId="a"
                fill={CHART_COLORS[i % CHART_COLORS.length]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </StatsChartBlock>

      <DonutBlock
        title={t("charts.mix.title")}
        help={t("charts.mix.help")}
        tableLabel={tableLabel}
        testId={`chart-${kind}-mix`}
        rows={dto.mix}
        money={money}
        year={null}
      />

      <StatsChartBlock
        testId={`chart-${kind}-largest`}
        title={t("charts.largestShare.title")}
        help={t("charts.largestShare.help")}
        tableLabel={tableLabel}
        table={
          <StatsDataTable
            headers={[t("a11y.period"), t("a11y.amount")]}
            rows={dto.largestShare.map((r) => [String(r.year), pct(r.tenths)])}
          />
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={dto.largestShare.map((r) => ({ year: r.year, share: r.tenths === null ? null : r.tenths / 10 }))}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="year" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={40} tickFormatter={percentTick} />
            {percentTooltipEl()}
            <Line dataKey="share" name={t("charts.largestShare.title")} stroke="hsl(var(--chart-2))" dot={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </StatsChartBlock>

      <StatsChartBlock
        testId={`chart-${kind}-matrix`}
        title={t("charts.matrix.title")}
        help={t("charts.matrix.help")}
        tableLabel={tableLabel}
        table={
          <StatsDataTable
            headers={[t("a11y.period"), t("a11y.category"), t("a11y.amount"), t("a11y.yoy")]}
            rows={dto.matrix.map((c) => [
              String(c.year),
              c.categoryActive ? c.categoryName : `${c.categoryName} (${tInactive})`,
              money(c.cents),
              pct(c.yoyTenths),
            ])}
          />
        }
      >
        <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
          {t("a11y.tableToggle")}
        </div>
      </StatsChartBlock>

      {kind === "expenses" && (
        <>
          <section className="bg-card rounded-lg border p-4" data-testid="chart-expenses-ranking">
            <h3 className="text-sm font-medium">{t("charts.ranking.title")}</h3>
            <p className="text-muted-foreground mb-3 text-xs">{t("charts.ranking.help")}</p>
            <ul className="flex flex-col gap-1">
              {dto.ranking.map((row) => (
                <li key={row.categoryId}>
                  <button
                    type="button"
                    className="hover:bg-accent flex min-h-11 w-full items-center justify-between rounded-lg px-2 text-sm"
                    onClick={() => onDrill(row.categoryId)}
                  >
                    <span>{row.categoryActive ? row.categoryName : `${row.categoryName} (${tInactive})`}</span>
                    <span className="amount tabular-nums">{money(row.cents)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3">
              <Collapsible title={tableLabel}>
                <StatsDataTable
                  headers={[t("a11y.period"), t("a11y.amount")]}
                  rows={dto.ranking.map((r) => [r.categoryName, money(r.cents)])}
                />
              </Collapsible>
            </div>
          </section>

          <StatsChartBlock
            testId="chart-expenses-seasonality"
            title={t("charts.seasonality.title")}
            help={t("charts.seasonality.help")}
            tableLabel={tableLabel}
            table={
              <StatsDataTable
                headers={[t("a11y.period"), t("a11y.amount")]}
                rows={dto.seasonality.map((r) => [monthName(locale, r.month), money(r.cents)])}
              />
            }
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dto.seasonality.map((r) => ({ label: monthName(locale, r.month), cents: r.cents }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={52} tickFormatter={moneyTick} />
                {moneyTooltipEl(money)}
                <Bar dataKey="cents" name={t("kpis.spend")} fill="hsl(var(--chart-3))" />
              </BarChart>
            </ResponsiveContainer>
          </StatsChartBlock>
        </>
      )}
      <span className="sr-only">{currency}</span>
    </div>
  );
}

function InflationTab({
  dto,
  money,
  tableLabel,
}: {
  dto: NonNullable<GlobalStatsPage["inflation"]>;
  money: (cents: number) => string;
  tableLabel: string;
}) {
  const t = useTranslations("stats");
  return (
    <div className="flex flex-col gap-6">
      {dto.impact && (
        <p className="text-sm leading-relaxed">{t(`inflation.impact.${dto.impact}`)}</p>
      )}
      {dto.largestCategoryName && (
        <p className="text-sm leading-relaxed">
          {t("inflation.impact.largestShare", {
            name: dto.largestCategoryName,
            latest: pct(dto.largestShareLatestTenths),
            base: pct(dto.largestShareBaseTenths),
          })}
        </p>
      )}

      {dto.comparable ? (
        <>
          <StatsChartBlock
            testId="chart-hcc"
            title={t("charts.hcc.title")}
            help={t("charts.hcc.help")}
            tableLabel={tableLabel}
            table={
              <StatsDataTable
                headers={[t("a11y.period"), "HCC"]}
                rows={dto.hccByYear.map((r) => [String(r.year), pct(r.tenths)])}
              />
            }
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dto.hccByYear.map((r) => ({ year: r.year, hcc: r.tenths === null ? null : r.tenths / 10 }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={40} tickFormatter={percentTick} />
                {percentTooltipEl()}
                <Bar dataKey="hcc" name="HCC" fill="hsl(var(--chart-1))" />
              </BarChart>
            </ResponsiveContainer>
          </StatsChartBlock>

          <StatsChartBlock
            testId="chart-income-vs-hcc"
            title={t("charts.incomeVsHcc.title")}
            help={t("charts.incomeVsHcc.help")}
            tableLabel={tableLabel}
            table={
              <StatsDataTable
                headers={[t("a11y.period"), t("kpis.income"), "HCC"]}
                rows={dto.incomeVsHcc.map((r) => [String(r.year), pct(r.incomeTenths), pct(r.hccTenths)])}
              />
            }
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dto.incomeVsHcc.map((r) => ({
                year: r.year,
                income: r.incomeTenths === null ? null : r.incomeTenths / 10,
                hcc: r.hccTenths === null ? null : r.hccTenths / 10,
              }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={40} tickFormatter={percentTick} />
                <Legend wrapperStyle={CHART_LEGEND_WRAPPER} />
                {percentTooltipEl()}
                <Bar dataKey="income" name={t("kpis.income")} fill={INCOME_COLOR} />
                <Bar dataKey="hcc" name="HCC" fill="hsl(var(--chart-1))" />
              </BarChart>
            </ResponsiveContainer>
          </StatsChartBlock>
        </>
      ) : (
        <p className="text-muted-foreground text-sm">{t("signals.empty")}</p>
      )}

      <StatsChartBlock
        testId="chart-contributions"
        title={t("charts.contributions.title")}
        help={t("charts.contributions.help")}
        tableLabel={tableLabel}
        table={
          <StatsDataTable
            headers={[t("a11y.period"), t("a11y.amount")]}
            rows={dto.contributions.map((r) => [r.categoryName, money(r.deltaCents)])}
          />
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dto.contributions} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="categoryName" width={100} tick={{ fontSize: 11 }} />
            {moneyTooltipEl(money)}
            <Bar dataKey="deltaCents" name={t("charts.contributions.title")}>
              {dto.contributions.map((r) => (
                <Cell
                  key={r.categoryId}
                  fill={r.deltaCents >= 0 ? "hsl(var(--destructive))" : INCOME_COLOR}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </StatsChartBlock>

      {dto.baskets.length > 0 && (
        <StatsChartBlock
          testId="chart-basket"
          title={t("charts.basket.title")}
          help={t("charts.basket.help")}
          tableLabel={tableLabel}
          table={
            <StatsDataTable
              headers={[t("a11y.period"), ...dto.baskets.map((b) => b.categoryName)]}
              rows={(dto.baskets[0]?.points ?? []).map((p, i) => [
                String(p.year),
                ...dto.baskets.map((b) => (b.points[i]?.index === null ? "—" : String(b.points[i]?.index))),
              ])}
            />
          }
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={(dto.baskets[0]?.points ?? []).map((p, i) => {
                const row: Record<string, number | string | null> = { year: p.year };
                for (const b of dto.baskets) {
                  row[b.categoryId] = b.points[i]?.index ?? null;
                }
                return row;
              })}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={40} tickFormatter={percentTick} />
              <Legend wrapperStyle={CHART_LEGEND_WRAPPER} />
              {percentTooltipEl()}
              {dto.baskets.map((b, i) => (
                <Line
                  key={b.categoryId}
                  dataKey={b.categoryId}
                  name={b.categoryName}
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  dot={false}
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </StatsChartBlock>
      )}

      <StatsChartBlock
        testId="chart-extra-cost"
        title={t("charts.extraCost.title")}
        help={t("charts.extraCost.help")}
        tableLabel={tableLabel}
        table={
          <StatsDataTable
            headers={[t("a11y.period"), t("a11y.amount")]}
            rows={dto.extraCost.map((r) => [String(r.year), money(r.cumulativeCents)])}
          />
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dto.extraCost.map((r) => ({ year: r.year, extra: r.cumulativeCents }))}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="year" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={52} tickFormatter={moneyTick} />
            {moneyTooltipEl(money)}
            <Bar dataKey="extra" name={t("charts.extraCost.title")} fill="hsl(var(--chart-4))" />
          </BarChart>
        </ResponsiveContainer>
      </StatsChartBlock>
    </div>
  );
}

function TrendGroupHeading({ label }: { label: string }) {
  return (
    <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
      {label}
    </h3>
  );
}

function TrendsTab({
  dto,
  money,
  locale,
  tableLabel,
}: {
  dto: NonNullable<GlobalStatsPage["trends"]>;
  money: (cents: number) => string;
  locale: "en" | "es";
  tableLabel: string;
}) {
  const t = useTranslations("stats");
  const tInactive = t("inactive");
  const cagrLabel = (r: { categoryName: string; categoryActive: boolean }) =>
    r.categoryActive ? r.categoryName : `${r.categoryName} (${tInactive})`;
  const groups = groupTrendSignals(dto.signals);
  const bySeverity = new Map(groups.map((g) => [g.severity, g]));
  const sparkByCat = new Map(dto.sparklines.map((s) => [s.categoryId, s.points]));
  const signalSection = (severity: TrendSeverity) => {
    const group = bySeverity.get(severity);
    if (!group) return null;
    return (
      <section key={severity} className="flex flex-col gap-3">
        <TrendGroupHeading label={t(`signals.group.${severity}`)} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {group.items.map((s) => (
            <TrendStatCard
              key={s.key}
              signal={s}
              title={signalTitle(t, s)}
              copy={signalCopy(t, s, locale)}
              caption={signalCaption(t, s, locale)}
              sparkPoints={s.categoryId ? sparkByCat.get(s.categoryId) : undefined}
              money={money}
              locale={locale}
              hero={signalHero(s, money, locale) ?? { value: "—" }}
            />
          ))}
        </div>
      </section>
    );
  };
  return (
    <div className="flex flex-col gap-6">
      {groups.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("signals.empty")}</p>
      ) : null}
      {signalSection("info")}
      {signalSection("watch")}

      <StatsChartBlock
        testId="chart-sparklines"
        title={t("charts.sparklines.title")}
        help={t("charts.sparklines.help")}
        tableLabel={tableLabel}
        table={
          <StatsDataTable
            headers={[t("a11y.period"), ...dto.sparklines.map((s) => s.categoryName)]}
            rows={(dto.sparklines[0]?.points ?? []).map((p, i) => [
              `${p.year}-${String(p.month).padStart(2, "0")}`,
              ...dto.sparklines.map((s) => money(s.points[i]?.cents ?? 0)),
            ])}
          />
        }
      >
        <div className="grid h-full grid-cols-2 gap-2 md:grid-cols-3">
          {dto.sparklines.map((s, i) => (
            <div key={s.categoryId} className="flex min-h-0 flex-col">
              <p className="truncate text-xs">{s.categoryName}</p>
              <div className="min-h-0 flex-1 overflow-visible">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={s.points.map((p) => ({
                      period: monthYear(locale, p.year, p.month),
                      cents: p.cents,
                      monthCents: p.monthCents,
                    }))}
                    margin={{ top: 8, right: 8, left: 4, bottom: 4 }}
                  >
                    <XAxis dataKey="period" hide />
                    <YAxis hide domain={["auto", "auto"]} />
                    {sparklineTooltipEl(money, t("charts.sparklines.rolling"), t("charts.sparklines.thisMonth"))}
                    <Line
                      dataKey="cents"
                      name={s.categoryName}
                      stroke={CHART_COLORS[i % CHART_COLORS.length]}
                      dot={false}
                      activeDot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
        </div>
      </StatsChartBlock>

      <StatsChartBlock
        testId="chart-overlay"
        title={t("charts.overlay.title")}
        help={t("charts.overlay.help")}
        tableLabel={tableLabel}
        table={
          <StatsDataTable
            headers={[t("a11y.period"), t("kpis.savingsRate"), "HCC"]}
            rows={dto.savingsRateOverlay.map((r) => [String(r.year), pct(r.savingsTenths), pct(r.hccTenths)])}
          />
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={dto.savingsRateOverlay.map((r) => ({
              year: r.year,
              savings: r.savingsTenths === null ? null : r.savingsTenths / 10,
              hcc: r.hccTenths === null ? null : r.hccTenths / 10,
            }))}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="year" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={40} tickFormatter={percentTick} />
            <Legend wrapperStyle={CHART_LEGEND_WRAPPER} />
            {percentTooltipEl()}
            <Line dataKey="savings" name={t("kpis.savingsRate")} stroke={INCOME_COLOR} dot={false} connectNulls={false} />
            <Line dataKey="hcc" name="HCC" stroke="hsl(var(--chart-1))" dot={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </StatsChartBlock>

      {signalSection("risk")}

      <StatsChartBlock
        testId="chart-deficits"
        title={t("charts.deficits.title")}
        help={t("charts.deficits.help")}
        tableLabel={tableLabel}
        table={
          <StatsDataTable
            headers={[t("a11y.period"), t("kpis.income"), t("kpis.spend")]}
            rows={dto.deficitMonths.map((r) => [
              `${monthName(locale, r.month)} ${r.year}`,
              money(r.incomeCents),
              money(r.spendCents),
            ])}
          />
        }
      >
        <div className="overflow-y-auto">
          <StatsDataTable
            headers={[t("a11y.period"), t("kpis.income"), t("kpis.spend")]}
            rows={dto.deficitMonths.map((r) => [
              `${monthName(locale, r.month)} ${r.year}`,
              money(r.incomeCents),
              money(r.spendCents),
            ])}
          />
        </div>
      </StatsChartBlock>

      <section className="flex flex-col gap-3">
        <TrendGroupHeading label={t("signals.group.growth")} />
        <StatsChartBlock
          testId="chart-cagr"
          title={t("charts.cagr.title")}
          help={t("charts.cagr.help")}
          tableLabel={tableLabel}
          table={
            <StatsDataTable
              headers={[t("a11y.category"), "CAGR"]}
              rows={dto.cagrRows.map((r) => [cagrLabel(r), pct(r.tenths)])}
            />
          }
        >
          <div className="overflow-y-auto">
            <StatsDataTable
              headers={[t("a11y.category"), "CAGR"]}
              rows={dto.cagrRows.map((r) => [cagrLabel(r), pct(r.tenths)])}
            />
          </div>
        </StatsChartBlock>
      </section>
    </div>
  );
}

function DonutBlock({
  title,
  help,
  tableLabel,
  testId,
  rows,
  money,
  year,
}: {
  title: string;
  help: string;
  tableLabel: string;
  testId: string;
  rows: Array<{ categoryId: string; categoryName: string; categoryActive: boolean; cents: number }>;
  money: (cents: number) => string;
  year: number | null;
}) {
  const t = useTranslations("stats");
  return (
    <StatsChartBlock
      testId={testId}
      title={year ? `${title} (${year})` : title}
      help={help}
      tableLabel={tableLabel}
      table={
        <StatsDataTable
          headers={[t("a11y.period"), t("a11y.amount")]}
          rows={rows.map((r) => [
            r.categoryActive ? r.categoryName : `${r.categoryName} (${t("inactive")})`,
            money(r.cents),
          ])}
        />
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={rows.map((r) => ({ name: r.categoryName, value: r.cents }))} dataKey="value" nameKey="name" innerRadius={40} outerRadius={80} paddingAngle={2}>
            {rows.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Legend wrapperStyle={CHART_LEGEND_WRAPPER} />
          {moneyTooltipEl(money)}
        </PieChart>
      </ResponsiveContainer>
    </StatsChartBlock>
  );
}

function KpiCard({
  label,
  value,
  caption,
  testId,
  hero,
  negative,
  warn,
}: {
  label: string;
  value: string;
  caption?: ReactNode;
  testId: string;
  hero?: boolean;
  negative?: boolean;
  warn?: boolean;
}) {
  const heroClass = hero
    ? negative
      ? "bg-destructive text-white"
      : "text-white"
    : warn
      ? "bg-warning/10 border-warning/30"
      : "bg-card text-card-foreground";
  return (
    <div
      data-testid={testId}
      className={`flex flex-col gap-1 rounded-lg border p-4 ${heroClass}`}
      style={hero && !negative ? { background: "var(--brand-gradient)" } : undefined}
    >
      <p className={`text-xs font-medium ${hero ? "text-white/80" : "text-muted-foreground"}`}>{label}</p>
      <p className="amount text-2xl font-semibold tabular-nums">{value}</p>
      {caption ? (
        <p className={`text-xs ${hero ? "text-white/80" : "text-muted-foreground"}`}>{caption}</p>
      ) : null}
    </div>
  );
}

function TrendStatCard({
  signal,
  title,
  copy,
  caption,
  sparkPoints,
  money,
  locale,
  hero: heroProp,
}: {
  signal: TrendSignal;
  title: string;
  copy: string;
  caption: string;
  sparkPoints?: Array<{ year: number; month: number; cents: number; monthCents?: number }>;
  money: (cents: number) => string;
  locale: "en" | "es";
  hero?: { value: string } | null;
}) {
  const t = useTranslations("stats");
  const hero = heroProp ?? signalHero(signal);
  const tone = signalTone(signal);
  if (!hero) return null;
  const sparkData = (sparkPoints ?? []).map((p) => ({
    period: monthYear(locale, p.year, p.month),
    cents: p.cents,
    monthCents: p.monthCents,
  }));
  return (
    <article
      data-testid={`signal-${signal.id}`}
      className={`flex flex-col gap-1 overflow-visible rounded-lg border border-l-[3px] p-4 ${tone.stat}`}
    >
      <p className="sr-only">{copy}</p>
      <p className="text-muted-foreground truncate text-xs font-medium tracking-wide uppercase">{title}</p>
      <p className={`amount text-2xl font-semibold tabular-nums md:text-3xl ${tone.value}`}>{hero.value}</p>
      <p className="text-muted-foreground text-xs leading-snug">{caption}</p>
      {sparkData.length > 1 ? (
        <div className={`relative z-10 mt-1 h-10 w-full overflow-visible ${tone.value}`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparkData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <XAxis dataKey="period" hide />
              <YAxis hide domain={["auto", "auto"]} />
              {sparklineTooltipEl(money, t("charts.sparklines.rolling"), t("charts.sparklines.thisMonth"))}
              <Line
                type="monotone"
                dataKey="cents"
                name={title}
                stroke="currentColor"
                dot={false}
                activeDot={{ r: 3 }}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </article>
  );
}

function signalHero(
  s: TrendSignal,
  money?: (cents: number) => string,
  locale?: "en" | "es",
): { value: string } | null {
  const m = s.metrics;
  if (typeof m.yoyTenths === "number") return { value: signedPct(m.yoyTenths) };
  if (typeof m.shareTenths === "number") return { value: pct(m.shareTenths) };
  if (typeof m.dropTenths === "number") return { value: pct(m.dropTenths) };
  if (typeof m.gapTenths === "number") return { value: pct(m.gapTenths) };
  if (s.id === "incomeSourceGone") return { value: pct(0) };
  if (s.id === "deficitMonth") {
    const count =
      typeof m.count === "number"
        ? m.count
        : String(m.months ?? "")
            .split(",")
            .filter(Boolean).length;
    return { value: String(count) };
  }
  if (s.id === "deficitYear") {
    if (typeof m.savingsCents === "number" && money) return { value: money(m.savingsCents) };
    if (m.year !== undefined) return { value: String(m.year) };
  }
  if (s.id === "openMonthReserve") {
    if (typeof m.remainingCents === "number" && money) return { value: money(m.remainingCents) };
  }
  if (s.id === "sparseYear" && m.year !== undefined) return { value: String(m.year) };
  if (s.id === "seasonalityPeak") {
    if (locale && typeof m.year === "number" && typeof m.month === "number") {
      return { value: monthYear(locale, m.year, m.month) };
    }
    if (m.years) {
      const count = String(m.years)
        .split(",")
        .filter((part) => part.trim().length > 0).length;
      return { value: String(count) };
    }
    if (m.year !== undefined) return { value: String(m.year) };
  }
  return null;
}

function signalTitle(t: ReturnType<typeof useTranslations>, s: TrendSignal): string {
  if (s.id === "deficitYear" && s.metrics.year !== undefined) return String(s.metrics.year);
  if (
    s.id === "deficitMonth" ||
    s.id === "savingsRateDrop" ||
    s.id === "spendOutpacingIncome" ||
    s.id === "openMonthReserve" ||
    s.id === "sparseYear" ||
    s.id === "seasonalityPeak"
  ) {
    return t(`signals.statTitle.${s.id}`);
  }
  if (typeof s.metrics.name === "string" && s.metrics.name.length > 0) return s.metrics.name;
  return s.id;
}

function signalCaption(
  t: ReturnType<typeof useTranslations>,
  s: TrendSignal,
  locale: "en" | "es",
): string {
  const m = s.metrics;
  const yearNum = typeof m.year === "number" ? m.year : undefined;
  const monthNum = typeof m.month === "number" ? m.month : undefined;
  const monthYearLabel =
    yearNum !== undefined && monthNum !== undefined
      ? monthYear(locale, yearNum, monthNum)
      : "";
  if (s.id === "seasonalityPeak" && m.years) {
    return t("signals.stat.seasonalityPeakMany", { years: m.years });
  }
  return t(`signals.stat.${s.id}`, {
    year: m.year ?? "",
    months: m.months ?? "",
    monthYear: monthYearLabel,
    years: m.years ?? "",
  });
}

function signalTone(s: TrendSignal): { shell: string; icon: string; stat: string; value: string } {
  if (s.id === "deficitMonth" || s.id === "deficitYear") {
    return {
      shell: "border-destructive/30 bg-destructive/10 text-foreground",
      icon: "text-destructive",
      stat: "border-border bg-card border-l-destructive",
      value: "text-destructive",
    };
  }
  if (s.severity === "watch") {
    return {
      shell: "border-warning/30 bg-warning/10 text-foreground",
      icon: "text-warning",
      stat: "border-border bg-card border-l-warning",
      value: "text-warning",
    };
  }
  return {
    shell: "bg-secondary text-secondary-foreground border-transparent",
    icon: "text-primary",
    stat: "border-border bg-card border-l-primary",
    value: "text-primary",
  };
}

function groupTrendSignals(
  signals: TrendSignal[],
): Array<{ severity: TrendSeverity; items: Array<TrendSignal & { key: string }> }> {
  const visible = signals.filter((s) => s.id !== "threeYearCagr");
  const peaks = visible.filter((s) => s.id === "seasonalityPeak");
  const rest = visible.filter((s) => s.id !== "seasonalityPeak");
  const display: TrendSignal[] = [...rest];
  if (peaks.length === 1 && peaks[0]) {
    display.push(peaks[0]);
  } else if (peaks.length > 1) {
    display.push({
      id: "seasonalityPeak",
      severity: "info",
      metrics: { years: peaks.map((p) => String(p.metrics.year)).join(", ") },
    });
  }
  const order: TrendSeverity[] = ["risk", "watch", "info"];
  return order
    .map((severity) => ({
      severity,
      items: display
        .filter((s) => s.severity === severity)
        .map((s, i) => ({
          ...s,
          key: `${s.id}-${s.categoryId ?? ""}-${String(s.metrics.year ?? s.metrics.years ?? s.metrics.months ?? i)}`,
        })),
    }))
    .filter((g) => g.items.length > 0);
}

function signalCopy(
  t: ReturnType<typeof useTranslations>,
  s: { id: string; metrics: Record<string, number | string> },
  locale: "en" | "es",
): string {
  const m = s.metrics;
  const drop = typeof m.dropTenths === "number" ? pct(m.dropTenths) : "";
  const gap = typeof m.gapTenths === "number" ? pct(m.gapTenths) : "";
  const yoy = typeof m.yoyTenths === "number" ? pct(m.yoyTenths) : "";
  const share = typeof m.shareTenths === "number" ? pct(m.shareTenths) : "";
  const yearNum = typeof m.year === "number" ? m.year : undefined;
  const monthNum = typeof m.month === "number" ? m.month : undefined;
  const monthYearLabel =
    yearNum !== undefined && monthNum !== undefined
      ? monthYear(locale, yearNum, monthNum)
      : "";
  if (s.id === "seasonalityPeak" && m.years) {
    return t("signals.seasonalityPeakMany", { years: m.years });
  }
  try {
    return t(`signals.${s.id}`, {
      drop,
      gap,
      yoy,
      share,
      name: m.name ?? "",
      year: m.year ?? "",
      years: m.years ?? "",
      month: m.month ?? "",
      months: m.months ?? "",
      monthYear: monthYearLabel,
      from: m.from ?? "",
      to: m.to ?? "",
    });
  } catch {
    return s.id;
  }
}
