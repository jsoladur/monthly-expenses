"use client";

import { useTranslations } from "next-intl";
import { AddAnnualForm } from "./add-annual-form";
import { AnnualRow } from "./annual-row";

export interface AnnualRowData {
  id: string;
  categoryId: string;
  categoryName: string;
  name: string;
  observations: string;
  chargeMonth: number;
  isDirectDebit: boolean;
  active: boolean;
}

export interface CategoryOption {
  id: string;
  name: string;
}

export function AnnualsScreen({
  initialAnnuals,
  expenseCategories,
  currency,
}: {
  locale: string;
  currency: string;
  initialAnnuals: AnnualRowData[];
  expenseCategories: CategoryOption[];
}) {
  const t = useTranslations("annuals");

  const groupedByMonth = groupByChargeMonth(initialAnnuals);
  const hasData = initialAnnuals.length > 0;

  return (
    <section className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t("help")}</p>

      <AddAnnualForm
        currency={currency}
        expenseCategories={expenseCategories}
      />

      {!hasData ? (
        <p className="text-muted-foreground px-1 py-6 text-center text-sm">
          {t("empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {groupedByMonth.map(({ month, annuals }) => (
            <div key={month} className="flex flex-col gap-2">
              <h3 className="text-foreground text-sm font-semibold">
                {getMonthName(month)}
              </h3>
              <ul className="flex flex-col gap-2">
                {annuals.map((row) => (
                  <AnnualRow
                    key={row.id}
                    annual={row}
                    currency={currency}
                    expenseCategories={expenseCategories}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function groupByChargeMonth(annuals: AnnualRowData[]): { month: number; annuals: AnnualRowData[] }[] {
  const map = new Map<number, AnnualRowData[]>();
  for (const annual of annuals) {
    const existing = map.get(annual.chargeMonth) ?? [];
    existing.push(annual);
    map.set(annual.chargeMonth, existing);
  }
  return Array.from(map.entries())
    .map(([month, annuals]) => ({ month, annuals }))
    .sort((a, b) => a.month - b.month);
}

function getMonthName(month: number): string {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return months[month - 1] ?? "";
}
