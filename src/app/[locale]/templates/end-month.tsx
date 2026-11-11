"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarCheck } from "lucide-react";
import { isAppLocale, monthName, monthYear } from "@/i18n/format";
import { routing } from "@/i18n/routing";
import { isValidEndMonth, type EndMonth } from "@/lib/template-end";

// ============================================================================
// Last payment month of a committed fixed expense (UC-29, PRD C29).
//
// `EndMonthField` is the add/edit form control, rendered on the Committed tab
// only. `null` = no last payment month (toggle off). Turning the toggle on
// restores the value picked before it was last turned off in this form, or
// starts at the current calendar month. While the year box holds something
// that is not a year, the value carries `year: NaN` so the form can refuse to
// submit (`isValidEndMonth`). The year box has no native min/max on purpose:
// the browser's own bubble is not translated by the app (PRD §11).
//
// `EndMonthNote` is the read-row caption: "Last payment: March 2027".
// ============================================================================

const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

const INPUT_CLASS =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-md border px-3 py-1 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none";

function useAppLocale() {
  const raw = useLocale();
  return isAppLocale(raw) ? raw : routing.defaultLocale;
}

function capitalize(text: string, locale: string): string {
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

export function EndMonthField({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: EndMonth | null;
  onChange: (next: EndMonth | null) => void;
}) {
  const t = useTranslations("templates.endMonth");
  const locale = useAppLocale();
  const enabled = value !== null;
  // Value kept while the toggle is off, so off → on restores it.
  const remembered = useRef<EndMonth | null>(value);
  // The year box is free text while typing; only whole years reach `value`.
  const [yearText, setYearText] = useState(value ? String(value.year) : "");

  const toggle = (on: boolean) => {
    if (!on) {
      remembered.current = value;
      onChange(null);
      return;
    }
    const now = new Date();
    const next = remembered.current ?? {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
    };
    setYearText(Number.isInteger(next.year) ? String(next.year) : "");
    onChange(next);
  };

  const changeYear = (text: string) => {
    setYearText(text);
    if (!value) return;
    const year = /^\d{4}$/.test(text.trim()) ? Number.parseInt(text, 10) : Number.NaN;
    onChange({ year, month: value.month });
  };

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">{t("legend")}</legend>
      <label
        htmlFor={`${idPrefix}-end-toggle`}
        className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"
      >
        <input
          id={`${idPrefix}-end-toggle`}
          type="checkbox"
          checked={enabled}
          onChange={(event) => toggle(event.target.checked)}
          className="accent-primary size-4 cursor-pointer"
        />
        <span>{t("toggle")}</span>
        {!enabled && <span className="text-muted-foreground text-xs">· {t("help")}</span>}
      </label>
      {value && (
        <>
          <div className="flex flex-wrap gap-2">
            <label htmlFor={`${idPrefix}-end-month`} className="sr-only">
              {t("month")}
            </label>
            <select
              id={`${idPrefix}-end-month`}
              value={value.month}
              onChange={(event) =>
                onChange({ year: value.year, month: Number.parseInt(event.target.value, 10) })
              }
              className={`${INPUT_CLASS} min-w-0 flex-1`}
            >
              {ALL_MONTHS.map((month) => (
                <option key={month} value={month}>
                  {capitalize(monthName(locale, month), locale)}
                </option>
              ))}
            </select>
            <label htmlFor={`${idPrefix}-end-year`} className="sr-only">
              {t("year")}
            </label>
            <input
              id={`${idPrefix}-end-year`}
              type="number"
              inputMode="numeric"
              step={1}
              value={yearText}
              onChange={(event) => changeYear(event.target.value)}
              placeholder={t("year")}
              autoComplete="off"
              className={`${INPUT_CLASS} amount w-24`}
            />
          </div>
          {isValidEndMonth(value) && (
            <p className="text-muted-foreground text-xs leading-relaxed">
              {t("note", { month: monthYear(locale, value.year, value.month) })}
            </p>
          )}
        </>
      )}
    </fieldset>
  );
}

export function EndMonthNote({ end }: { end: EndMonth | null }) {
  const t = useTranslations("templates.endMonth");
  const locale = useAppLocale();
  if (end === null) return null;

  return (
    <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
      <CalendarCheck aria-hidden="true" className="size-3.5 shrink-0" />
      {t("rowLabel", { month: monthYear(locale, end.year, end.month) })}
    </span>
  );
}
