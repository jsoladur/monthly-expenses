import { getTranslations } from "next-intl/server";
import { formatMoney } from "@/i18n/format";
import type { MonthSummary } from "@/server/services/summary";

export interface SummaryBlockProps {
  summary: MonthSummary;
  currency: string;
}

// UC-24: when the month has savings-category rows, the hero spells out
// the money rule as a ledger line under "Left over":
//   + Invested = Total saved
// Months without savings rows render exactly as before.
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
        {summary.hasSavingsRows && (
          <dl
            className="mt-4 flex items-end gap-3 border-t border-white/30 pt-3 text-white sm:gap-4"
            title={t("totalSavedHelp")}
          >
            <SavingsTerm
              operator="+"
              label={t("invested")}
              value={formatMoney(summary.investedTotal, currency)}
              testId="summary-invested"
            />
            <SavingsTerm
              operator="="
              label={t("totalSaved")}
              value={formatMoney(summary.totalSaved, currency)}
              testId="summary-total-saved"
              strong
            />
          </dl>
        )}
      </div>
      <dl className="bg-card text-card-foreground grid grid-cols-2 gap-3 rounded-lg border p-4 text-sm md:grid-cols-4">
        <SummaryCell label={t("income")} cents={summary.incomesTotal} currency={currency} testId="summary-income" />
        <SummaryCell label={t("actuals")} cents={summary.actualsTotal} currency={currency} testId="summary-actuals" />
        <SummaryCell label={t("reserved")} cents={summary.reservedRemainingTotal} currency={currency} testId="summary-reserved" />
        <SummaryCell
          label={t(summary.hasSavingsRows ? "totalExpensesInclInvested" : "totalExpenses")}
          cents={summary.actualsTotal + summary.reservedRemainingTotal}
          currency={currency}
          testId="summary-total-expenses"
          highlight
          caption={
            summary.hasSavingsRows ? (
              <>
                {t("spending")}{" "}
                <span className="amount" data-testid="summary-spending">
                  {formatMoney(summary.spendingTotal, currency)}
                </span>
              </>
            ) : undefined
          }
        />
      </dl>
    </section>
  );
}

function SavingsTerm({
  operator,
  label,
  value,
  testId,
  strong,
}: {
  operator: "+" | "=";
  label: string;
  value: string;
  testId: string;
  strong?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-end gap-2 sm:gap-3">
      <span aria-hidden className="pb-4 text-xl leading-none font-light text-white/70">
        {operator}
      </span>
      <div className="flex min-w-0 flex-col">
        <dt className="order-2 text-xs text-white/80">{label}</dt>
        <dd
          className={`amount order-1 truncate leading-tight ${strong ? "text-lg font-semibold md:text-xl" : "text-base font-medium md:text-lg"}`}
          data-testid={testId}
        >
          {value}
        </dd>
      </div>
    </div>
  );
}

function SummaryCell({
  label,
  cents,
  currency,
  testId,
  highlight,
  caption,
}: {
  label: string;
  cents: number;
  currency: string;
  testId: string;
  highlight?: boolean;
  caption?: React.ReactNode;
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
      {caption && <dd className="text-muted-foreground text-xs">{caption}</dd>}
    </div>
  );
}
