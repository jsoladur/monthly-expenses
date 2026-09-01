"use client";

import { useTranslations } from "next-intl";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { formatMoney } from "@/i18n/format";
import {
  ChartTooltip,
  CHART_LEGEND_WRAPPER,
  CHART_TOOLTIP_PROPS,
} from "@/components/chart-tooltip";
import { StatsGlossary } from "@/components/stats-glossary";

interface CategoryExpense {
  categoryName: string;
  amountCents: number;
}

interface ReservedLineCategoryExpense {
  categoryName: string;
  remainingCents: number;
}

interface StatsScreenProps {
  actuals: CategoryExpense[];
  reservedLines: ReservedLineCategoryExpense[];
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
  actualsTotalCents,
  reservedRemainingTotalCents,
  committedTotalCents,
  currency,
}: StatsScreenProps) {
  const t = useTranslations("months.stats");

  const categoryData = aggregateByCategory(actuals, reservedLines);
  const categoryPercentData = toPercentages(categoryData);
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
        ) : (
          <p className="text-muted-foreground py-8 text-center text-sm">
            {t("noData")}
          </p>
        )}
      </section>

      <section className="bg-card text-card-foreground overflow-visible rounded-lg border p-4">
        <h3 className="mb-4 text-sm font-medium">
          {t("distribution")}
        </h3>
        {hasDistributionData ? (
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

function aggregateByCategory(
  actuals: CategoryExpense[],
  reservedLines: ReservedLineCategoryExpense[],
) {
  const map = new Map<string, number>();
  for (const actual of actuals) {
    const current = map.get(actual.categoryName) ?? 0;
    map.set(actual.categoryName, current + actual.amountCents);
  }
  for (const line of reservedLines) {
    const current = map.get(line.categoryName) ?? 0;
    map.set(line.categoryName, current + line.remainingCents);
  }
  return Array.from(map.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
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
