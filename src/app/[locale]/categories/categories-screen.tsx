"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AddCategoryForm } from "./add-category-form";
import { CategoryRow } from "./category-row";
import { CreateDrawer } from "@/components/create-drawer";

type Kind = "expense" | "income";

export interface CategoryRowData {
  id: string;
  name: string;
  active: boolean;
  countsAsSavings: boolean;
}

export function CategoriesScreen({
  initialExpense,
  initialIncome,
  canCreate = true,
  canManage = true,
}: {
  locale: string;
  initialExpense: CategoryRowData[];
  initialIncome: CategoryRowData[];
  /** UC-31 §3: create = Editor+; rename/deactivate/savings = Admin+. */
  canCreate?: boolean;
  canManage?: boolean;
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
        className="bg-muted/40 inline-flex w-full rounded-lg p-1 text-sm"
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
              className={`flex-1 rounded-md px-3 py-2 font-medium transition-all cursor-pointer ${
                isActive
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              }`}
            >
              {t(`tabs.${option}`)}
            </button>
          );
        })}
      </div>

      {canCreate && (
        <CreateDrawer label={t(`new.${kind}`)} testId="new-category">
          {(close) => <AddCategoryForm kind={kind} onCreated={close} />}
        </CreateDrawer>
      )}

      {kind === "expense" && canManage && (
        <p id="savings-help" className="text-muted-foreground px-1 text-xs leading-relaxed">
          {t("savings.help")}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-muted-foreground px-1 py-6 text-center text-sm">
          {t(emptyKey)}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <CategoryRow key={row.id} category={row} kind={kind} canManage={canManage} />
          ))}
        </ul>
      )}
    </section>
  );
}
