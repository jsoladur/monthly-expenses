"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AddTemplateForm } from "./add-template-form";
import { TemplateRow } from "./template-row";

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

  return (
    <section className="flex flex-col gap-4">
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
