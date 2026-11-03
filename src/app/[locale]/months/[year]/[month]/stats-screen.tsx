"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { List, PiggyBank } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { formatMoney } from "@/i18n/format";
import {
  ChartTooltip,
  CHART_LEGEND_WRAPPER,
  CHART_TOOLTIP_PROPS,
} from "@/components/chart-tooltip";
import { StatsGlossary } from "@/components/stats-glossary";
import { Collapsible } from "@/components/ui/collapsible";
import { IconButton } from "@/components/ui/icon-button";
import { StatsDataTable } from "@/app/[locale]/stats/stats-chart-block";
import { CategoryExpenseDetailsDialog } from "@/app/[locale]/months/[year]/[month]/category-expense-details";
import {
  buildCategoryBreakdowns,
  type CategoryBreakdown,
  type StatsActualLine,
  type StatsReservedLine,
} from "@/app/[locale]/months/[year]/[month]/stats-category-types";

interface StatsScreenProps {
  actuals: StatsActualLine[];
  reservedLines: StatsReservedLine[];
  /** UC-24: these categories are left out of the category pie. */
  savingsCategoryIds: string[];
  /** UC-24: null when the month has no savings-category rows. */
  investedTotalCents: number | null;
  actualsTotalCents: number;
  reservedRemainingTotalCents: number;
  committedTotalCents: number;
  currency: string;
}

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--accent))",
  "hsl(var(--destructive))",
  "hsl(var(--muted-foreground))",
];

const DISTRIBUTION_COLORS = [
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
];

export function StatsScreen({
  actuals,
  reservedLines,
  savingsCategoryIds,
  investedTotalCents,
  actualsTotalCents,
  reservedRemainingTotalCents,
  committedTotalCents,
  currency,
}: StatsScreenProps) {
  const t = useTranslations("months.stats");
  const [detailsCategoryId, setDetailsCategoryId] = useState<string | null>(null);

  const savings = new Set(savingsCategoryIds);
  const categories = buildCategoryBreakdowns(
    actuals.filter((line) => !savings.has(line.categoryId)),
    reservedLines.filter((line) => !savings.has(line.categoryId)),
  );
  const categoryData = categories.map((c) => ({ name: c.name, value: c.value }));
  const categoryPercentData = toPercentages(categoryData);
  const detailsCategory = categories.find((c) => c.categoryId === detailsCategoryId) ?? null;
  const distributionData = buildDistributionData(
    actualsTotalCents,
    reservedRemainingTotalCents,
    committedTotalCents,
    t,
  );
  const distributionPercentData = toPercentages(distributionData);

  const hasCategoryData = categoryData.length > 0;
  const hasDistributionData = distributionData.some((d) => d.value > 0);

  const moneyTip = (
    <Tooltip
      content={<ChartTooltip formatValue={(v) => formatMoney(v, currency)} />}
      {...CHART_TOOLTIP_PROPS}
    />
  );
  const percentTip = (
    <Tooltip
      content={<ChartTooltip formatValue={(v) => `${v.toFixed(1)}%`} />}
      {...CHART_TOOLTIP_PROPS}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <section className="bg-card text-card-foreground overflow-visible rounded-lg border p-4">
        <h3 className="mb-4 text-sm font-medium">
          {t("expensesByCategory")}
        </h3>
        {hasCategoryData ? (
          <div className="flex flex-col gap-3">
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <p className="text-muted-foreground mb-2 text-center text-xs">
                  {t("percent")}
                </p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoryPercentData}
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="percent"
                        nameKey="name"
                      >
                        {categoryPercentData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Legend wrapperStyle={CHART_LEGEND_WRAPPER} />
                      {percentTip}
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div>
                <p className="text-muted-foreground mb-2 text-center text-xs">
                  {t("absolute")}
                </p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoryData}
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="value"
                        nameKey="name"
                      >
                        {categoryData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Legend wrapperStyle={CHART_LEGEND_WRAPPER} />
                      {moneyTip}
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
            <Collapsible title={t("tableToggle")}>
              <CategoryStatsTable
                categories={categories}
                currency={currency}
                onShowDetails={setDetailsCategoryId}
              />
            </Collapsible>
            <CategoryExpenseDetailsDialog
              category={detailsCategory}
              currency={currency}
              onClose={() => setDetailsCategoryId(null)}
            />
          </div>
        ) : (
          <p className="text-muted-foreground py-8 text-center text-sm">
            {t("noData")}
          </p>
        )}
        {investedTotalCents !== null && (
          <p
            className="border-success/40 bg-success/10 mt-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm"
            data-testid="stats-invested"
          >
            <span className="flex items-center gap-1.5 font-medium">
              <PiggyBank className="text-success-foreground size-4 self-center" aria-hidden />
              {t("invested")}
              <span className="amount">{formatMoney(investedTotalCents, currency)}</span>
            </span>
            <span className="text-muted-foreground text-xs">{t("investedHelp")}</span>
          </p>
        )}
      </section>

      <section className="bg-card text-card-foreground overflow-visible rounded-lg border p-4">
        <h3 className="mb-4 text-sm font-medium">
          {t("distribution")}
        </h3>
        {hasDistributionData ? (
          <div className="flex flex-col gap-3">
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <p className="text-muted-foreground mb-2 text-center text-xs">
                  {t("percent")}
                </p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={distributionPercentData}
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="percent"
                        nameKey="name"
                      >
                        {distributionPercentData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={DISTRIBUTION_COLORS[index % DISTRIBUTION_COLORS.length]} />
                        ))}
                      </Pie>
                      <Legend wrapperStyle={CHART_LEGEND_WRAPPER} />
                      {percentTip}
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div>
                <p className="text-muted-foreground mb-2 text-center text-xs">
                  {t("absolute")}
                </p>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={distributionData}
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="value"
                        nameKey="name"
                      >
                        {distributionData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={DISTRIBUTION_COLORS[index % DISTRIBUTION_COLORS.length]} />
                        ))}
                      </Pie>
                      <Legend wrapperStyle={CHART_LEGEND_WRAPPER} />
                      {moneyTip}
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
            <Collapsible title={t("tableToggle")}>
              <StatsDataTable
                headers={[t("expensesType"), t("amount")]}
                rows={distributionData.map((r) => [r.name, formatMoney(r.value, currency)])}
              />
            </Collapsible>
          </div>
        ) : (
          <p className="text-muted-foreground py-8 text-center text-sm">
            {t("noData")}
          </p>
        )}
      </section>
    </div>
  );
}

export function MonthStatsHelp() {
  const t = useTranslations("months.stats");
  return (
    <StatsGlossary
      title={t("glossary.title")}
      groups={[
        {
          items: [
            { term: t("glossary.actuals.term"), definition: t("glossary.actuals.def") },
            { term: t("glossary.reserved.term"), definition: t("glossary.reserved.def") },
            { term: t("glossary.committed.term"), definition: t("glossary.committed.def") },
          ],
        },
      ]}
    />
  );
}

function CategoryStatsTable({
  categories,
  currency,
  onShowDetails,
}: {
  categories: CategoryBreakdown[];
  currency: string;
  onShowDetails: (categoryId: string) => void;
}) {
  const t = useTranslations("months.stats");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            <th className="text-muted-foreground pb-2 pr-3 font-medium">{t("categoryName")}</th>
            <th className="text-muted-foreground pb-2 pr-3 font-medium">{t("amount")}</th>
            <th className="text-muted-foreground pb-2 font-medium">
              <span className="sr-only">{t("actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {categories.map((category) => (
            <tr key={category.categoryId} className="border-border border-t">
              <td className="py-1.5 pr-3">{category.name}</td>
              <td className="amount py-1.5 pr-3 tabular-nums">
                {formatMoney(category.value, currency)}
              </td>
              <td className="py-1.5 text-right">
                {category.value >= 0 && (
                  <IconButton
                    icon={<List />}
                    label={t("showDetails")}
                    className="size-11"
                    onClick={() => onShowDetails(category.categoryId)}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function toPercentages(data: { name: string; value: number }[]) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) return data.map((d) => ({ ...d, percent: 0 }));
  return data.map((d) => ({
    ...d,
    percent: (d.value / total) * 100,
  }));
}

function buildDistributionData(
  actualsTotalCents: number,
  reservedRemainingTotalCents: number,
  committedTotalCents: number,
  t: (key: string) => string,
) {
  return [
    { name: t("actuals"), value: actualsTotalCents },
    { name: t("reserved"), value: reservedRemainingTotalCents },
    { name: t("committed"), value: committedTotalCents },
  ];
}
