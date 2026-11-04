"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Bell, CheckCircle2, ChevronDown } from "lucide-react";
import { Collapsible } from "@/components/ui/collapsible";
import { formatMoney } from "@/i18n/format";
import type { AnnualMatch } from "@/lib/annual-match";

export interface AnnualReminder {
  id: string;
  name: string;
  categoryName: string;
  isDirectDebit: boolean;
  amountCents: number | null;
  /** UC-28: a line of this month that looks like this annual, if any. */
  match: AnnualMatch | null;
}

export function AnnualReminderCards({
  reminders,
  monthName,
  currency,
}: {
  reminders: AnnualReminder[];
  monthName: string;
  currency: string;
}) {
  const t = useTranslations("reminders");

  if (reminders.length === 0) {
    return null;
  }

  // Pending reminders first; handled ones sink to the bottom (stable order).
  const ordered = [
    ...reminders.filter((r) => r.match === null),
    ...reminders.filter((r) => r.match !== null),
  ];
  const pendingCount = ordered.filter((r) => r.match === null).length;
  const allHandled = pendingCount === 0;

  return (
    <Collapsible
      title={
        <span className="flex items-center gap-2">
          <Bell
            className={`size-4 ${allHandled ? "text-muted-foreground" : "text-warning"}`}
            aria-hidden
          />
          {t("title")}
        </span>
      }
      count={allHandled ? undefined : pendingCount}
      variant={allHandled ? "default" : "warning"}
    >
      <ul className="flex flex-col gap-3">
        {ordered.map((reminder) => (
          <li key={reminder.id}>
            {reminder.match === null ? (
              <ReminderDetails reminder={reminder} monthName={monthName} currency={currency} />
            ) : (
              <MatchedReminder
                reminder={reminder}
                match={reminder.match}
                monthName={monthName}
                currency={currency}
              />
            )}
          </li>
        ))}
      </ul>
    </Collapsible>
  );
}

function ReminderDetails({
  reminder,
  monthName,
  currency,
  showName = true,
}: {
  reminder: AnnualReminder;
  monthName: string;
  currency: string;
  showName?: boolean;
}) {
  const t = useTranslations("reminders");
  const tAnnuals = useTranslations("annuals");
  return (
    <div className="flex flex-col gap-1">
      {showName && <p className="text-sm font-medium">{reminder.name}</p>}
      <p className="text-muted-foreground text-xs">
        {reminder.categoryName}
        {reminder.amountCents !== null && (
          <> · {formatMoney(reminder.amountCents, currency)}</>
        )}
        {reminder.isDirectDebit && (
          <span className="bg-warning/20 ml-2 rounded-full px-2 py-0.5 text-xs">
            {tAnnuals("isDirectDebit")}
          </span>
        )}
      </p>
      <p className="text-muted-foreground text-xs leading-relaxed">
        {t("annual", { month: monthName })}
      </p>
    </div>
  );
}

function MatchedReminder({
  reminder,
  match,
  monthName,
  currency,
}: {
  reminder: AnnualReminder;
  match: AnnualMatch;
  monthName: string;
  currency: string;
}) {
  const t = useTranslations("annuals.reminder");
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();

  return (
    <div
      className="bg-muted/40 border-border rounded-md border"
      data-testid="annual-reminder-added"
    >
      <div className="flex items-start gap-2 px-3 py-2">
        <CheckCircle2 className="text-success mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{reminder.name}</p>
          <p className="text-muted-foreground text-xs break-words">
            {t("added", {
              name: match.name,
              amount: formatMoney(match.amountCents, currency),
            })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={detailsId}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring -my-1 inline-flex shrink-0 min-h-8 items-center gap-1 rounded-md px-2 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          {expanded ? t("hideDetails") : t("showDetails")}
          <ChevronDown
            className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
            aria-hidden
          />
        </button>
      </div>
      {expanded && (
        <div id={detailsId} className="border-border border-t px-3 py-2">
          <ReminderDetails
            reminder={reminder}
            monthName={monthName}
            currency={currency}
            showName={false}
          />
        </div>
      )}
    </div>
  );
}
