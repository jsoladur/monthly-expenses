"use client";

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
import { formatMoney, isAppLocale, monthName, monthYear } from "@/i18n/format";
import { formatPercentTenths } from "@/server/money";
import type { GlobalStatsPage, StatsTabId } from "@/server/services/global-stats";
import { Collapsible } from "@/components/ui/collapsible";
import {
  CHART_COLORS,
  StatsChartBlock,
  StatsDataTable,
  TOOLTIP_STYLE,
} from "@/app/[locale]/stats/stats-chart-block";

const TABS: StatsTabId[] = ["overview", "incomes", "expenses", "inflation", "trends"];

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
    );
  }

  const money = (cents: number) => formatMoney(cents, meta.currency);
  const go = (patch: Partial<ViewState>) => router.replace(statsPath({ ...state, ...patch }));

  const yearOptions = meta.years;

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-card border-border sticky top-0 z-20 flex flex-col gap-3 rounded-lg border p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">{t("filters.from")}</span>
            <select
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
          <span className="text-muted-foreground ml-auto text-xs">
            {t("filters.currency")}: {meta.currency}
          </span>
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

      {meta.openMonth && (
        <p className="bg-secondary text-secondary-foreground rounded-lg px-4 py-3 text-sm leading-relaxed">
          {t("openMonthNote", {
            monthYear: monthYear(locale, meta.openMonth.year, meta.openMonth.month),
            amount: money(meta.openMonth.remainingCents),
          })}
        </p>
      )}

      <div
        className="border-border flex gap-1 overflow-x-auto border-b"
        role="tablist"
        aria-label={t("a11y.tabs")}
      >
        {TABS.map((tab) => (
          <Link
            key={tab}
            href={statsPath({ ...state, tab })}
            role="tab"
            aria-selected={meta.tab === tab}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${
              meta.tab === tab
                ? "border-primary text-primary"
                : "text-muted-foreground hover:text-foreground border-transparent"
            }`}
          >
            {t(`tabs.${tab}`)}
          </Link>
        ))}
      </div>

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
    </div>
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
          caption={`${t("kpis.vsPrior")}: ${o.incomeDelta.centsDelta === null ? "—" : money(o.incomeDelta.centsDelta)} (${pct(o.incomeDelta.percentTenths)})`}
        />
        <KpiCard
          testId="stats-kpi-spend"
          label={t("kpis.spend")}
          value={money(o.spendCents)}
          caption={`${t("kpis.vsPrior")}: ${o.spendDelta.centsDelta === null ? "—" : money(o.spendDelta.centsDelta)} (${pct(o.spendDelta.percentTenths)})`}
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
          caption={o.savingsRateDeltaTenths === null ? "—" : pct(o.savingsRateDeltaTenths)}
          warn={o.savingsRateDeltaTenths !== null && o.savingsRateDeltaTenths <= -50}
        />
      </div>
      {o.snapshot && (
        <p className="text-sm leading-relaxed" data-testid="stats-snapshot">
          {t("overview.snapshot", {
            from: o.snapshot.fromYear,
            to: o.snapshot.toYear,
            spendFrom: money(o.snapshot.spendFromCents),
            spendTo: money(o.snapshot.spendToCents),
            spendPct: pct(o.snapshot.spendPctTenths),
            incFrom: money(o.snapshot.incomeFromCents),
            incTo: money(o.snapshot.incomeToCents),
            incPct: pct(o.snapshot.incomePctTenths),
            rateFrom: pct(o.snapshot.rateFromTenths),
            rateTo: pct(o.snapshot.rateToTenths),
          })}
        </p>
      )}

      <StatsChartBlock
        testId="chart-income-vs-spend"
        title={t("charts.incomeVsSpend.title")}
        help={t("charts.incomeVsSpend.help")}
        tableLabel={tableLabel}
        table={
          <StatsDataTable
            headers={["", t("kpis.income"), t("kpis.spend")]}
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
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => (typeof v === "number" ? money(v) : "—")} />
            <Legend />
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
            headers={["", t("kpis.income"), t("kpis.spend")]}
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
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => (typeof v === "number" ? money(v) : "—")} />
            <Legend />
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
            headers={["", t("kpis.savingsRate")]}
            rows={o.savingsRateByYear.map((r) => [String(r.year), pct(r.tenths)])}
          />
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={o.savingsRateByYear.map((r) => ({ year: r.year, rate: r.tenths === null ? null : r.tenths / 10 }))}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="year" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => (typeof v === "number" ? `${v.toFixed(1)}%` : "—")} />
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
      <StatsChartBlock
        testId={`chart-${kind}-yearly`}
        title={t("charts.yearly.title")}
        help={t("charts.yearly.help")}
        tableLabel={tableLabel}
        table={
          <StatsDataTable
            headers={["", ""]}
            rows={yearlyData.map((r) => [r.label, money(r.cents)])}
          />
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={yearlyData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => (typeof v === "number" ? money(v) : "—")} />
            <Bar dataKey="cents" fill={kind === "incomes" ? INCOME_COLOR : SPEND_COLOR} />
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
            headers={["", ""]}
            rows={monthlyData.map((r) => [r.label, r.cents === null ? "—" : money(r.cents)])}
          />
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => (typeof v === "number" ? money(v) : "—")} />
            <Line dataKey="cents" stroke={kind === "incomes" ? INCOME_COLOR : SPEND_COLOR} dot={false} connectNulls={false} />
            {kind === "expenses" && dto.rolling.length > 0 && granularity === "month" ? (
              <Line
                data={dto.rolling.map((r) => ({
                  label: `${r.year}-${String(r.month).padStart(2, "0")}`,
                  rolling: r.cents,
                }))}
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
            headers={["", ...stackedCats.map((c) => c.categoryName)]}
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
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => (typeof v === "number" ? money(v) : "—")} />
            <Legend wrapperStyle={{ fontSize: "0.75rem" }} />
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
            headers={["", ""]}
            rows={dto.largestShare.map((r) => [String(r.year), pct(r.tenths)])}
          />
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={dto.largestShare.map((r) => ({ year: r.year, share: r.tenths === null ? null : r.tenths / 10 }))}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="year" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => (typeof v === "number" ? `${v.toFixed(1)}%` : "—")} />
            <Line dataKey="share" stroke="hsl(var(--chart-2))" dot={false} connectNulls={false} />
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
            headers={["", "", "", "YoY"]}
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
                  headers={["", ""]}
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
                headers={["", ""]}
                rows={dto.seasonality.map((r) => [monthName(locale, r.month), money(r.cents)])}
              />
            }
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dto.seasonality.map((r) => ({ label: monthName(locale, r.month), cents: r.cents }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => (typeof v === "number" ? money(v) : "—")} />
                <Bar dataKey="cents" fill="hsl(var(--chart-3))" />
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
      <p className="bg-secondary text-secondary-foreground rounded-lg px-4 py-3 text-sm leading-relaxed" data-testid="stats-inflation-disclaimer">
        {t("inflation.disclaimer")}
      </p>
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
                headers={["", "HCC"]}
                rows={dto.hccByYear.map((r) => [String(r.year), pct(r.tenths)])}
              />
            }
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dto.hccByYear.map((r) => ({ year: r.year, hcc: r.tenths === null ? null : r.tenths / 10 }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => (typeof v === "number" ? `${v.toFixed(1)}%` : "—")} />
                <Bar dataKey="hcc" fill="hsl(var(--chart-1))" />
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
                headers={["", t("kpis.income"), "HCC"]}
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
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => (typeof v === "number" ? `${v.toFixed(1)}%` : "—")} />
                <Legend />
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
            headers={["", ""]}
            rows={dto.contributions.map((r) => [r.categoryName, money(r.deltaCents)])}
          />
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dto.contributions} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="categoryName" width={100} tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => (typeof v === "number" ? money(v) : "—")} />
            <Bar dataKey="deltaCents">
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
              headers={["", ...dto.baskets.map((b) => b.categoryName)]}
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
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: "0.75rem" }} />
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
            headers={["", ""]}
            rows={dto.extraCost.map((r) => [String(r.year), money(r.cumulativeCents)])}
          />
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dto.extraCost.map((r) => ({ year: r.year, extra: r.cumulativeCents }))}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="year" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => (typeof v === "number" ? money(v) : "—")} />
            <Bar dataKey="extra" fill="hsl(var(--chart-4))" />
          </BarChart>
        </ResponsiveContainer>
      </StatsChartBlock>
    </div>
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
  const visible = dto.signals.filter((s) => s.id !== "threeYearCagr");
  return (
    <div className="flex flex-col gap-6">
      {visible.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("signals.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((s, i) => (
            <li
              key={`${s.id}-${i}`}
              data-testid={`signal-${s.id}`}
              className={`rounded-lg px-4 py-3 text-sm leading-relaxed ${signalClass(s.id, s.severity)}`}
            >
              {signalCopy(t, s)}
            </li>
          ))}
        </ul>
      )}

      <StatsChartBlock
        testId="chart-sparklines"
        title={t("charts.sparklines.title")}
        help={t("charts.sparklines.help")}
        tableLabel={tableLabel}
        table={
          <StatsDataTable
            headers={["", ...dto.sparklines.map((s) => s.categoryName)]}
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
              <div className="min-h-0 flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={s.points.map((p) => ({ label: p.month, cents: p.cents }))}>
                    <Line
                      dataKey="cents"
                      stroke={CHART_COLORS[i % CHART_COLORS.length]}
                      dot={false}
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
            headers={["", t("kpis.savingsRate"), "HCC"]}
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
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => (typeof v === "number" ? `${v.toFixed(1)}%` : "—")} />
            <Legend />
            <Line dataKey="savings" name={t("kpis.savingsRate")} stroke={INCOME_COLOR} dot={false} connectNulls={false} />
            <Line dataKey="hcc" name="HCC" stroke="hsl(var(--chart-1))" dot={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </StatsChartBlock>

      <StatsChartBlock
        testId="chart-deficits"
        title={t("charts.deficits.title")}
        help={t("charts.deficits.help")}
        tableLabel={tableLabel}
        table={
          <StatsDataTable
            headers={["", t("kpis.income"), t("kpis.spend")]}
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
            headers={["", t("kpis.income"), t("kpis.spend")]}
            rows={dto.deficitMonths.map((r) => [
              `${monthName(locale, r.month)} ${r.year}`,
              money(r.incomeCents),
              money(r.spendCents),
            ])}
          />
        </div>
      </StatsChartBlock>

      <StatsChartBlock
        testId="chart-cagr"
        title={t("charts.cagr.title")}
        help={t("charts.cagr.help")}
        tableLabel={tableLabel}
        table={
          <StatsDataTable
            headers={["", "CAGR"]}
            rows={dto.cagrRows.map((r) => [r.categoryId, pct(r.tenths)])}
          />
        }
      >
        <div className="overflow-y-auto">
          <StatsDataTable
            headers={["", "CAGR"]}
            rows={dto.cagrRows.map((r) => [r.categoryId, pct(r.tenths)])}
          />
        </div>
      </StatsChartBlock>
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
          headers={["", ""]}
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
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => (typeof v === "number" ? money(v) : "—")} />
          <Legend wrapperStyle={{ fontSize: "0.75rem" }} />
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
  caption: string;
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
      <p className={`text-xs ${hero ? "text-white/80" : "text-muted-foreground"}`}>{caption}</p>
    </div>
  );
}

function signalClass(id: string, severity: string): string {
  if (id === "deficitMonth" || id === "deficitYear") {
    return "bg-destructive/10 text-destructive";
  }
  if (severity === "watch") {
    return "bg-warning/10 text-warning";
  }
  return "bg-secondary text-secondary-foreground";
}

function signalCopy(
  t: ReturnType<typeof useTranslations>,
  s: { id: string; metrics: Record<string, number | string> },
): string {
  const m = s.metrics;
  const drop = typeof m.dropTenths === "number" ? pct(m.dropTenths) : "";
  const gap = typeof m.gapTenths === "number" ? pct(m.gapTenths) : "";
  const yoy = typeof m.yoyTenths === "number" ? pct(m.yoyTenths) : "";
  const share = typeof m.shareTenths === "number" ? pct(m.shareTenths) : "";
  try {
    return t(`signals.${s.id}`, {
      drop,
      gap,
      yoy,
      share,
      year: m.year ?? "",
      month: m.month ?? "",
      months: m.months ?? "",
      from: m.from ?? "",
      to: m.to ?? "",
    });
  } catch {
    return s.id;
  }
}
