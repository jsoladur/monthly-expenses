"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AddTemplateForm } from "./add-template-form";
import { TemplateRow } from "./template-row";

// ============================================================================
// Templates screen — interactive part (UC-05).
//
// Client component because it owns the kind-tab state. Reads are RSC
// (page.tsx) so this component stays purely presentational + tab switching;
// mutations happen via the per-row form actions rendered in `TemplateRow`.
//
// The screen receives:
//   - `initialTemplates`: serialised rows with `amountCents` (integer, never
//     raw wire strings — keeps ADR-5 / ARCH §8 on the domain side).
//   - `expenseCategories`: ACTIVE expense categories for the picker.
//   - `currency`: the user's display label (PRD UC-15).
// ============================================================================

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
        className="bg-muted/40 inline-flex w-full rounded-md p-1 text-sm"
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
              className={
                "flex-1 rounded-sm px-3 py-1.5 font-medium transition-colors " +
                (isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground")
              }
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
