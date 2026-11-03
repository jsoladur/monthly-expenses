"use client";

import { useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { isAppLocale, monthShortName } from "@/i18n/format";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/utils";

// ============================================================================
// Fixed expense month schedule (UC-20, PRD C23, STYLE-GUIDE §5).
//
// `MonthScheduleField` is the add/edit form control. `null` = every month
// (toggle off). Turning the toggle on restores the months picked before it
// was last turned off in this form, or starts with none selected; the
// service normalizes a 12-month schedule back to `null` and rejects an empty
// one.
//
// `ScheduleRail` is the read-row summary: a 12-segment strip (aria-hidden)
// plus the short month list that carries the meaning for screen readers.
// ============================================================================

const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

function useAppLocale() {
  const raw = useLocale();
  return isAppLocale(raw) ? raw : routing.defaultLocale;
}

export function MonthScheduleField({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: number[] | null;
  onChange: (next: number[] | null) => void;
}) {
  const t = useTranslations("templates.schedule");
  const locale = useAppLocale();
  const enabled = value !== null;
  const selected = new Set(value ?? []);
  // Selection kept while the toggle is off, so off → on restores it.
  const remembered = useRef<number[]>(value ?? []);

  const toggleSchedule = (on: boolean) => {
    if (on) {
      onChange([...remembered.current]);
    } else {
      remembered.current = value ?? [];
      onChange(null);
    }
  };

  const toggleMonth = (month: number) => {
    const next = new Set(selected);
    if (next.has(month)) next.delete(month);
    else next.add(month);
    onChange(Array.from(next).sort((a, b) => a - b));
  };

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">{t("legend")}</legend>
      <label
        htmlFor={`${idPrefix}-schedule-toggle`}
        className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"
      >
        <input
          id={`${idPrefix}-schedule-toggle`}
          type="checkbox"
          checked={enabled}
          onChange={(event) => toggleSchedule(event.target.checked)}
          className="accent-primary size-4 cursor-pointer"
        />
        <span>{t("toggle")}</span>
        {!enabled && (
          <span className="text-muted-foreground text-xs">· {t("help")}</span>
        )}
      </label>
      {enabled && (
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-12">
          {ALL_MONTHS.map((month) => {
            const isOn = selected.has(month);
            return (
              <button
                key={month}
                type="button"
                aria-pressed={isOn}
                onClick={() => toggleMonth(month)}
                className={cn(
                  "h-11 cursor-pointer rounded-md border text-xs font-medium transition-colors focus-visible:ring-ring/50 focus-visible:ring-3 focus-visible:outline-none",
                  isOn
                    ? "border-primary bg-secondary text-primary font-semibold"
                    : "border-border text-muted-foreground hover:text-foreground border-dashed bg-transparent",
                )}
              >
                {monthShortName(locale, month)}
              </button>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

export function ScheduleRail({ months }: { months: number[] | null }) {
  const t = useTranslations("templates.schedule");
  const locale = useAppLocale();
  if (months === null) return null;
  const applies = new Set(months);
  const list = months.map((m) => monthShortName(locale, m)).join(" · ");

  return (
    <span className="flex flex-wrap items-center gap-2">
      <span aria-hidden="true" className="flex gap-0.5">
        {ALL_MONTHS.map((month) => (
          <span
            key={month}
            className={cn(
              "h-1.5 w-2 rounded-full",
              applies.has(month) ? "bg-primary" : "bg-border",
            )}
          />
        ))}
      </span>
      <span className="text-muted-foreground text-xs">
        {t("monthsList", { months: list })}
      </span>
    </span>
  );
}
