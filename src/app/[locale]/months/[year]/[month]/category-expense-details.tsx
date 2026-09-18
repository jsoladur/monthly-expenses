"use client";

import { useEffect, useId, useRef } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { formatMoney } from "@/i18n/format";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";
import type { CategoryBreakdown, CategoryLine } from "./stats-category-types";

export function CategoryExpenseDetailsDialog({
  category,
  currency,
  onClose,
}: {
  category: CategoryBreakdown | null;
  currency: string;
  onClose: () => void;
}) {
  const t = useTranslations("months.stats");
  const tCommon = useTranslations("common");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const open = category !== null;

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open) {
      if (!el.open) el.showModal();
    } else if (el.open) {
      el.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={cn(
        "bg-card text-card-foreground border-border w-full max-w-lg max-h-[85dvh] flex-col overflow-hidden border p-0 shadow-sm",
        "m-0 mt-auto rounded-t-xl md:m-auto md:rounded-xl",
        "backdrop:bg-black/40",
        "open:flex",
      )}
    >
      {category && (
        <>
          <div className="border-border border-b">
            <div className="bg-muted mx-auto mt-2 h-1 w-10 rounded-full md:hidden" aria-hidden />
            <div className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <h2 id={titleId} className="truncate text-base font-semibold">
                  {category.name}
                </h2>
                <p id={descriptionId} className="text-muted-foreground text-sm">
                  {t("detailsDescription")}
                </p>
              </div>
              <IconButton icon={<X />} label={tCommon("close")} onClick={onClose} />
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex flex-col gap-4 overflow-y-auto px-4 py-4">
              <LineGroup
                title={t("actuals")}
                empty={t("noLines")}
                currency={currency}
                lines={category.actuals}
                railClass="border-l-primary"
              />
              <LineGroup
                title={t("estimated")}
                empty={t("noLines")}
                currency={currency}
                lines={category.estimated}
                railClass="border-l-estimated"
                badgeClass="bg-estimated/15 text-estimated"
              />
              <LineGroup
                title={t("committed")}
                empty={t("noLines")}
                currency={currency}
                lines={category.committed}
                railClass="border-l-committed"
                badgeClass="bg-committed text-primary-foreground"
              />
            </div>
            <footer className="border-border flex items-baseline justify-between gap-3 border-t px-4 py-3">
              <p className="text-sm font-medium">{t("total")}</p>
              <p className="amount text-sm font-medium tabular-nums">
                {formatMoney(category.value, currency)}
              </p>
            </footer>
          </div>
        </>
      )}
    </dialog>
  );
}

function LineGroup({
  title,
  empty,
  currency,
  lines,
  railClass,
  badgeClass,
}: {
  title: string;
  empty: string;
  currency: string;
  lines: CategoryLine[];
  railClass: string;
  badgeClass?: string;
}) {
  const total = lines.reduce((sum, line) => sum + line.amountCents, 0);
  return (
    <section className={cn("border-border rounded-lg border border-l-4", railClass)}>
      <header className="flex items-baseline justify-between gap-3 px-3 py-2">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-medium">
          {badgeClass ? (
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", badgeClass)}>
              {title}
            </span>
          ) : (
            title
          )}
          <span className="text-muted-foreground text-xs tabular-nums">{lines.length}</span>
        </h3>
        <p className="amount text-sm tabular-nums">{formatMoney(total, currency)}</p>
      </header>
      {lines.length === 0 ? (
        <p className="text-muted-foreground px-3 pb-3 text-sm">{empty}</p>
      ) : (
        <ul className="divide-border divide-y">
          {lines.map((line) => (
            <li key={line.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate">{line.name}</span>
                {line.observations && (
                  <span className="text-muted-foreground block truncate text-xs italic">
                    {line.observations}
                  </span>
                )}
              </span>
              <span className="amount shrink-0 tabular-nums">
                {formatMoney(line.amountCents, currency)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
