"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AddCategoryForm } from "./add-category-form";
import { CategoryRow } from "./category-row";

// ============================================================================
// Categories screen — interactive part (UC-03).
//
// Client component because it owns the tab state and renders one of two
// column lists. Reads are RSC (page.tsx) so this component stays purely
// presentational + tab-switching — mutations happen via the per-row form
// actions rendered in `CategoryRow`.
// ============================================================================

type Kind = "expense" | "income";

export interface CategoryRowData {
  id: string;
  name: string;
  active: boolean;
}

export function CategoriesScreen({
  initialExpense,
  initialIncome,
}: {
  locale: string;
  initialExpense: CategoryRowData[];
  initialIncome: CategoryRowData[];
}) {
  const t = useTranslations("categories");
  const [kind, setKind] = useState<Kind>("expense");
  const rows = kind === "expense" ? initialExpense : initialIncome;
  const emptyKey = kind === "expense" ? "empty.expense" : "empty.income";

  return (
    <section className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label={t("title")}
        className="bg-muted/40 inline-flex w-full rounded-md p-1 text-sm"
      >
        {(["expense", "income"] as const).map((option) => {
          const isActive = option === kind;
          return (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-current={isActive ? "page" : undefined}
              onClick={() => setKind(option)}
              className={
                "flex-1 rounded-sm px-3 py-1.5 font-medium transition-colors " +
                (isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {t(`tabs.${option}`)}
            </button>
          );
        })}
      </div>

      <AddCategoryForm kind={kind} />

      {rows.length === 0 ? (
        <p className="text-muted-foreground px-1 py-6 text-center text-sm">
          {t(emptyKey)}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <CategoryRow key={row.id} category={row} />
          ))}
        </ul>
      )}
    </section>
  );
}
