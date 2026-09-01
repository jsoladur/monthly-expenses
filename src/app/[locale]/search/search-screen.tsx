"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { formatMoney, isAppLocale, monthName } from "@/i18n/format";
import { routing } from "@/i18n/routing";
import { SEARCH_TERM_MAX_LENGTH, SEARCH_TERM_MIN_LENGTH } from "@/server/search/sanitize";
import type { SearchActualHit, SearchActualsResult } from "@/server/search/types";

export function SearchScreen({
  currency,
  rawQuery,
  result,
}: {
  currency: string;
  rawQuery: string;
  result: SearchActualsResult;
}) {
  const t = useTranslations("search");
  const tActuals = useTranslations("actuals");
  const localeRaw = useLocale();
  const locale = isAppLocale(localeRaw) ? localeRaw : routing.defaultLocale;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const [query, setQuery] = useState(rawQuery);
  const canSearch = query.trim().length >= SEARCH_TERM_MIN_LENGTH;

  useEffect(() => {
    setQuery(rawQuery);
  }, [rawQuery]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (!canSearch) {
      event.preventDefault();
    }
  }

  useEffect(() => {
    if (result.status === "idle") return;
    if (result.status === "tooShort") {
      alertRef.current?.focus();
      return;
    }
    headingRef.current?.focus();
  }, [result.status, rawQuery]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>

      <div className="bg-secondary sticky top-0 z-20 rounded-[var(--radius)] border border-border p-4">
        <form
          action={`/${locale}/search`}
          method="GET"
          onSubmit={handleSubmit}
          className="flex flex-col gap-2 md:flex-row md:items-end"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor="search-q" className="text-sm">
              {t("placeholder")}
            </label>
            <input
              id="search-q"
              name="q"
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              minLength={SEARCH_TERM_MIN_LENGTH}
              maxLength={SEARCH_TERM_MAX_LENGTH}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={t("placeholder")}
              className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-11 w-full rounded-md border px-3 text-sm shadow-xs focus-visible:ring-3 focus-visible:outline-none"
            />
          </div>
          <Button
            type="submit"
            size="lg"
            className="w-full md:w-auto"
            data-testid="search-submit"
            disabled={!canSearch}
          >
            {t("actions.submit")}
          </Button>
        </form>
        {result.status === "tooShort" && (
          <p
            ref={alertRef}
            role="alert"
            tabIndex={-1}
            className="text-destructive mt-2 text-sm outline-none"
          >
            {t("tooShort")}
          </p>
        )}
      </div>

      {result.status === "idle" && (
        <p className="text-muted-foreground text-sm leading-relaxed">{t("idle")}</p>
      )}

      {result.status === "empty" && (
        <section aria-live="polite" data-testid="search-results">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-sm font-medium outline-none"
          >
            {t("a11y.results")}
          </h2>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t("empty", { q: rawQuery })}
          </p>
        </section>
      )}

      {result.status === "ok" && (
        <section
          aria-live="polite"
          data-testid="search-results"
          className="flex flex-col gap-4"
        >
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-sm font-medium outline-none"
          >
            {t("a11y.results")}
            <span className="text-muted-foreground ml-2 font-normal">
              {t("count", { count: result.hits.length })}
            </span>
          </h2>
          {result.truncated && (
            <p className="text-muted-foreground text-sm">{t("truncated")}</p>
          )}
          {groupHits(result.hits).map((yearGroup) => (
            <div
              key={yearGroup.year}
              className="lg:grid lg:grid-cols-[4.5rem_1fr] lg:gap-x-6"
            >
              <h3 className="text-primary py-1 text-lg lg:sticky lg:top-4 lg:self-start">
                {yearGroup.year}
              </h3>
              <div className="flex flex-col gap-4">
                {yearGroup.months.map((monthGroup) => (
                  <div key={monthGroup.month} className="flex flex-col gap-2">
                    <h4 className="text-lg">{monthName(locale, monthGroup.month)}</h4>
                    <ul className="flex flex-col gap-2">
                      {monthGroup.hits.map((hit) => (
                        <li key={hit.id}>
                          <SearchHitRow
                            hit={hit}
                            currency={currency}
                            inactiveNote={tActuals("historicalInactiveNote")}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function SearchHitRow({
  hit,
  currency,
  inactiveNote,
}: {
  hit: SearchActualHit;
  currency: string;
  inactiveNote: string;
}) {
  return (
    <Link
      href={`/months/${hit.year}/${hit.month}`}
      data-testid="search-hit"
      className="bg-card focus-visible:border-ring focus-visible:ring-ring/50 flex flex-wrap items-center gap-2 rounded-md border px-4 py-2 text-sm outline-none focus-visible:ring-3"
    >
      <span className="min-w-0 flex-1 flex flex-col">
        <span className="truncate">{hit.name}</span>
        <span className="text-muted-foreground truncate text-xs">{hit.categoryName}</span>
        {hit.observations && (
          <span className="text-muted-foreground truncate text-xs italic">
            {hit.observations}
          </span>
        )}
      </span>
      <span className="tabular-nums shrink-0 whitespace-nowrap">
        {formatMoney(hit.amountCents, currency)}
      </span>
      {!hit.categoryActive && (
        <p className="text-muted-foreground basis-full text-xs">{inactiveNote}</p>
      )}
    </Link>
  );
}

type YearGroup = {
  year: number;
  months: { month: number; hits: SearchActualHit[] }[];
};

function groupHits(hits: SearchActualHit[]): YearGroup[] {
  const years: YearGroup[] = [];
  for (const hit of hits) {
    let yearGroup = years[years.length - 1];
    if (!yearGroup || yearGroup.year !== hit.year) {
      yearGroup = { year: hit.year, months: [] };
      years.push(yearGroup);
    }
    let monthGroup = yearGroup.months[yearGroup.months.length - 1];
    if (!monthGroup || monthGroup.month !== hit.month) {
      monthGroup = { month: hit.month, hits: [] };
      yearGroup.months.push(monthGroup);
    }
    monthGroup.hits.push(hit);
  }
  return years;
}
