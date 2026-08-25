"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { AddTemplateForm } from "./add-template-form";
import { TemplateRow } from "./template-row";
import { formatMoney } from "@/i18n/format";
import { Collapsible } from "@/components/ui/collapsible";

type Kind = "committed" | "estimated";

export interface TemplateRowData {
  id: string;
  categoryId: string;
  categoryName: string;
  kind: Kind;
  name: string;
  observations: string;
  amountCents: number;
  active: boolean;
}

export interface CategoryOption {
  id: string;
  name: string;
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

export function TemplatesScreen({
  initialTemplates,
  expenseCategories,
  currency,
}: {
  locale: string;
  currency: string;
  initialTemplates: TemplateRowData[];
  expenseCategories: CategoryOption[];
}) {
  const t = useTranslations("templates");
  const [kind, setKind] = useState<Kind>("committed");
  const rows = initialTemplates.filter((row) => row.kind === kind);

  const totalMonthlyExpenses = initialTemplates.reduce(
    (sum, row) => sum + row.amountCents,
    0,
  );

  const categoryData = aggregateByCategory(initialTemplates);
  const categoryPercentData = toPercentages(categoryData);
  const hasCategoryData = categoryData.length > 0;

  const tooltipFormatter = (value: unknown) => {
    const numValue = typeof value === "number" ? value : Number(value);
    return formatMoney(numValue, currency);
  };

  const percentTooltipFormatter = (value: unknown) => {
    const numValue = typeof value === "number" ? value : Number(value);
    return `${numValue.toFixed(1)}%`;
  };

  return (
    <section className="flex flex-col gap-4">
      {hasCategoryData && (
        <Collapsible title={t("distribution")}>
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
                    <Tooltip
                      formatter={percentTooltipFormatter}
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "0.5rem",
                      }}
                    />
                    <Legend />
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
                    <Tooltip
                      formatter={tooltipFormatter}
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "0.5rem",
                      }}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </Collapsible>
      )}

      <div className="rounded-lg p-5" style={{ background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)" }}>
        <h2 className="text-white/80 text-sm font-medium">
          {t("totalMonthlyExpenses")}
        </h2>
        <p className="amount text-2xl font-semibold text-white md:text-3xl">
          {formatMoney(totalMonthlyExpenses, currency)}
        </p>
      </div>

      <div
        role="tablist"
        aria-label={t("title")}
        className="bg-muted/40 inline-flex w-full rounded-lg p-1 text-sm"
      >
        {(["committed", "estimated"] as const).map((option) => {
          const isActive = option === kind;
          return (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-current={isActive ? "page" : undefined}
              onClick={() => setKind(option)}
              className={`flex-1 rounded-md px-3 py-2 font-medium transition-all cursor-pointer ${
                isActive
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              }`}
            >
              {t(`kind.${option}`)}
            </button>
          );
        })}
      </div>

      <AddTemplateForm
        kind={kind}
        currency={currency}
        expenseCategories={expenseCategories}
      />

      {rows.length === 0 ? (
        <p className="text-muted-foreground px-1 py-6 text-center text-sm">
          {t("empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <TemplateRow
              key={row.id}
              template={row}
              currency={currency}
              expenseCategories={expenseCategories}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function aggregateByCategory(templates: TemplateRowData[]) {
  const map = new Map<string, number>();
  for (const template of templates) {
    const current = map.get(template.categoryName) ?? 0;
    map.set(template.categoryName, current + template.amountCents);
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
