import { getTranslations } from "next-intl/server";
import { formatMoney } from "@/i18n/format";
import type { MonthSummary } from "@/server/services/summary";

// ============================================================================
// Month summary block (UC-11, PRD §7.1, §19).
//
// Renders the workspace summary header: income / actuals / reserved /
// potential savings. Pure presentation — the RSC parent (workspace page) has
// already loaded `MonthSummary` from `getMonthSummary(userId, monthId)`.
//
// The four amounts come in as integer cents (ADR-5, ARCH §8) and are
// formatted with `formatMoney` so the display mirrors the wire format
// (dot decimal in BOTH locales, no grouping separator — PRD C9).
//
// Negative values (refunds, payouts) render with a leading minus, and a
// tiny footnote reminds the user they count (PRD §7.6).
// ============================================================================

export interface SummaryBlockProps {
  summary: MonthSummary;
  currency: string;
}

export async function SummaryBlock({ summary, currency }: SummaryBlockProps) {
  const t = await getTranslations("months.summary");
  const negative = summary.potentialSavings < 0;

  return (
    <section
      aria-labelledby="summary-heading"
      className="bg-card text-card-foreground flex flex-col gap-3 rounded-md border p-4"
    >
      <h2 id="summary-heading" className="text-base font-semibold">
        {t("savings")}
      </h2>
      <p
        className={
          negative
            ? "tabular-nums text-2xl font-semibold text-destructive"
            : "tabular-nums text-2xl font-semibold"
        }
        data-testid="summary-savings"
      >
        {formatMoney(summary.potentialSavings, currency)}
      </p>
      <dl className="grid grid-cols-3 gap-2 text-sm">
        <SummaryCell label={t("income")} cents={summary.incomesTotal} currency={currency} testId="summary-income" />
        <SummaryCell label={t("actuals")} cents={summary.actualsTotal} currency={currency} testId="summary-actuals" />
        <SummaryCell label={t("reserved")} cents={summary.reservedRemainingTotal} currency={currency} testId="summary-reserved" />
      </dl>
    </section>
  );
}

function SummaryCell({
  label,
  cents,
  currency,
  testId,
}: {
  label: string;
  cents: number;
  currency: string;
  testId: string;
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="tabular-nums text-sm" data-testid={testId}>
        {formatMoney(cents, currency)}
      </dd>
    </div>
  );
}