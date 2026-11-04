"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/i18n/format";
import { applyEstimateSuggestionAction } from "@/actions/estimate-check";
import type {
  EstimateCheck,
  EstimateCheckCategory,
  EstimateCheckMode,
} from "@/lib/estimate-check";

// ============================================================================
// Estimate check UI (UC-25).
//
// Lives in its own month-workspace tab ("Estimate check", after "Data").
// Every fix is explicit and confirmed inline with the new remaining.
// A flag is a hint ("possible overlap"): tickets carry no link to the
// envelope they were paid from, so each card lists them for the user.
// ============================================================================

export function EstimateCheckPanel({
  monthId,
  year,
  month,
  currency,
  check,
  isPast,
}: {
  monthId: string;
  year: number;
  month: number;
  currency: string;
  check: EstimateCheck;
  isPast: boolean;
}) {
  const t = useTranslations("estimateCheck");

  if (check.categories.length === 0) {
    return (
      <p className="text-muted-foreground text-sm" data-testid="estimate-check-none">
        {t("noEstimates")}
      </p>
    );
  }

  const flaggedCount = check.categories.filter((c) => c.flagged).length;

  return (
    <section className="flex flex-col gap-4" data-testid="estimate-check-panel">
      <p className="text-muted-foreground text-sm leading-relaxed">{t("description")}</p>

      {flaggedCount === 0 && (
        <p
          className="bg-success/10 text-foreground rounded-lg px-3 py-3 text-sm"
          data-testid="estimate-check-empty"
        >
          {t("empty")}
        </p>
      )}

      <ul className="grid gap-3 md:grid-cols-2">
        {check.categories.map((category) => (
          <CategoryCard
            key={category.categoryId}
            category={category}
            currency={currency}
            isPast={isPast}
            onApply={(mode) =>
              applyEstimateSuggestionAction({
                monthId,
                categoryId: category.categoryId,
                year,
                month,
                mode,
              })
            }
          />
        ))}
      </ul>
    </section>
  );
}

function CategoryCard({
  category,
  currency,
  isPast,
  onApply,
}: {
  category: EstimateCheckCategory;
  currency: string;
  isPast: boolean;
  onApply: (mode: EstimateCheckMode) => Promise<{ ok: boolean }>;
}) {
  const t = useTranslations("estimateCheck");
  const tc = useTranslations("common");
  const [confirming, setConfirming] = useState<EstimateCheckMode | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  const money = (cents: number) => formatMoney(cents, currency);
  const canRelease = isPast && category.remaining !== 0;
  const newRemaining = confirming === "release" ? 0 : category.suggested;

  const apply = async () => {
    if (!confirming || pending) return;
    setPending(true);
    setError(false);
    const result = await onApply(confirming);
    setPending(false);
    if (result.ok) setConfirming(null);
    else setError(true);
  };

  return (
    <li
      className={`bg-card flex flex-col gap-3 rounded-lg border p-3 ${
        category.flagged ? "border-l-estimated border-l-4" : ""
      }`}
      data-testid="estimate-check-category"
      data-flagged={category.flagged}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="truncate text-sm font-semibold">{category.categoryName}</h3>
        {category.flagged ? (
          <span className="bg-estimated/12 text-estimated shrink-0 rounded-full px-2 py-0.5 text-xs font-medium">
            {t("possibleOverlap", { amount: money(category.remaining - category.suggested) })}
          </span>
        ) : (
          <span className="text-muted-foreground shrink-0 text-xs">{t("matches")}</span>
        )}
      </div>

      <dl className="grid grid-cols-3 gap-2 text-xs">
        <Figure label={t("plan")} value={money(category.plan)} />
        <Figure label={t("spent")} value={money(category.tickets)} />
        <Figure label={t("reserved")} value={money(category.remaining)} strong={category.flagged} />
      </dl>

      <EnvelopeBar category={category} />

      {category.ticketList.length > 0 && (
        <details className="group text-xs" data-testid="estimate-check-tickets">
          <summary className="text-primary flex min-h-11 cursor-pointer list-none items-center gap-1 font-medium [&::-webkit-details-marker]:hidden">
            <ChevronDown
              className="size-3.5 transition-transform group-open:rotate-180"
              aria-hidden
            />
            {t("showTickets", { count: category.ticketList.length })}
          </summary>
          <ul className="flex flex-col gap-1 pt-1">
            {category.ticketList.map((ticket) => (
              <li
                key={ticket.id}
                className={`flex items-baseline justify-between gap-2 ${
                  ticket.counted ? "" : "text-muted-foreground"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">
                  {ticket.name}
                  {!ticket.counted && (
                    <span className="ml-1 italic">· {t("ticketFromLine")}</span>
                  )}
                </span>
                <span className={`amount shrink-0 tabular-nums ${ticket.counted ? "" : "line-through"}`}>
                  {money(ticket.amount)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {category.flagged && !confirming && (
        <p className="text-muted-foreground text-xs leading-relaxed">{t("overlapHint")}</p>
      )}

      {confirming ? (
        <div className="bg-secondary text-secondary-foreground flex flex-col gap-2 rounded-md p-3 text-sm">
          <p>
            {t(confirming === "release" ? "confirmRelease" : "confirmSuggest", {
              category: category.categoryName,
              amount: money(newRemaining),
            })}
          </p>
          {error && (
            <p role="alert" className="text-destructive text-xs">
              {t("error")}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 flex-1"
              disabled={pending}
              onClick={() => {
                setConfirming(null);
                setError(false);
              }}
            >
              {tc("cancel")}
            </Button>
            <Button
              type="button"
              className="h-11 flex-1"
              disabled={pending}
              onClick={() => void apply()}
              data-testid="estimate-check-confirm"
            >
              {t("apply")}
            </Button>
          </div>
        </div>
      ) : (
        (category.flagged || canRelease) && (
          <div className="flex flex-wrap gap-2">
            {category.flagged && (
              <Button
                type="button"
                className="h-11 flex-1"
                onClick={() => setConfirming("suggested")}
                data-testid="estimate-check-suggest"
              >
                {t("suggest", { amount: money(category.suggested) })}
              </Button>
            )}
            {canRelease && (
              <Button
                type="button"
                variant="outline"
                className="h-11 flex-1"
                onClick={() => setConfirming("release")}
                data-testid="estimate-check-release"
              >
                {t("release")}
              </Button>
            )}
          </div>
        )
      )}
    </li>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`amount text-sm tabular-nums ${strong ? "text-estimated font-semibold" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

// Tickets (solid teal) + still reserved (teal tint) against the plan. When
// the two add up to more than the plan, the overflow past the plan tick is
// the POSSIBLE overlap — drawn hatched so it reads without color alone.
function EnvelopeBar({ category }: { category: EstimateCheckCategory }) {
  const spent = Math.max(category.tickets, 0);
  const reserved = Math.max(category.remaining, 0);
  const scale = Math.max(category.plan, spent + reserved, 1);
  const pct = (cents: number) => `${Math.min((cents / scale) * 100, 100)}%`;
  const reservedWithinPlan = Math.max(Math.min(reserved, category.plan - spent), 0);
  const doubled = Math.max(spent + reserved - Math.max(category.plan, spent), 0);
  const planTick = category.plan > 0 ? (category.plan / scale) * 100 : null;

  return (
    <div className="relative h-2 w-full" aria-hidden>
      <div className="bg-muted flex h-full w-full overflow-hidden rounded-full">
        <div className="bg-estimated h-full" style={{ width: pct(spent) }} />
        <div className="bg-estimated/35 h-full" style={{ width: pct(reservedWithinPlan) }} />
        <div
          className="h-full"
          style={{
            width: pct(doubled),
            backgroundImage:
              "repeating-linear-gradient(135deg, hsl(var(--estimated) / 0.55) 0 3px, transparent 3px 6px)",
          }}
        />
      </div>
      {planTick !== null && planTick < 100 && (
        <div
          className="bg-foreground absolute -top-0.5 h-3 w-0.5 rounded-full"
          style={{ left: `calc(${planTick}% - 1px)` }}
        />
      )}
    </div>
  );
}
