import { getTranslations } from "next-intl/server";
import { formatMoney } from "@/i18n/format";
import type { MonthSummary } from "@/server/services/summary";

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
      className="flex flex-col gap-4"
    >
      <div
        className={
          negative
            ? "bg-destructive rounded-lg p-5"
            : "rounded-lg p-5"
        }
        style={!negative ? { background: "var(--brand-gradient)" } : undefined}
      >
        <h2 id="summary-heading" className="text-white/80 text-sm font-medium">
          {t("savings")}
        </h2>
        <p
          className="amount text-4xl font-semibold text-white md:text-5xl"
          data-testid="summary-savings"
        >
          {formatMoney(summary.potentialSavings, currency)}
        </p>
      </div>
      <dl className="bg-card text-card-foreground grid grid-cols-2 gap-3 rounded-lg border p-4 text-sm md:grid-cols-4">
        <SummaryCell label={t("income")} cents={summary.incomesTotal} currency={currency} testId="summary-income" />
        <SummaryCell label={t("actuals")} cents={summary.actualsTotal} currency={currency} testId="summary-actuals" />
        <SummaryCell label={t("reserved")} cents={summary.reservedRemainingTotal} currency={currency} testId="summary-reserved" />
        <SummaryCell label={t("totalExpenses")} cents={summary.actualsTotal + summary.reservedRemainingTotal} currency={currency} testId="summary-total-expenses" highlight />
      </dl>
    </section>
  );
}

function SummaryCell({
  label,
  cents,
  currency,
  testId,
  highlight,
}: {
  label: string;
  cents: number;
  currency: string;
  testId: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd
        className={`amount text-sm font-medium ${highlight ? "text-base" : ""}`}
        data-testid={testId}
      >
        {formatMoney(cents, currency)}
      </dd>
    </div>
  );
}
