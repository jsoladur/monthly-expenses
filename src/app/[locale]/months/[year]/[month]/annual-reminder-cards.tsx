"use client";

import { useTranslations } from "next-intl";
import { Bell } from "lucide-react";
import { Collapsible } from "@/components/ui/collapsible";

export interface AnnualReminder {
  id: string;
  name: string;
  categoryName: string;
  isDirectDebit: boolean;
}

export function AnnualReminderCards({
  reminders,
  monthName,
}: {
  reminders: AnnualReminder[];
  monthName: string;
}) {
  const t = useTranslations("reminders");
  const tAnnuals = useTranslations("annuals");

  if (reminders.length === 0) {
    return null;
  }

  return (
    <Collapsible
      title={
        <span className="flex items-center gap-2">
          <Bell className="text-warning size-4" />
          {t("title")}
        </span>
      }
      count={reminders.length}
      variant="warning"
    >
      <div className="flex flex-col gap-3">
        {reminders.map((reminder) => (
          <div
            key={reminder.id}
            className="flex flex-col gap-1"
          >
            <p className="text-sm font-medium">
              {reminder.name}
            </p>
            <p className="text-muted-foreground text-xs">
              {reminder.categoryName}
              {reminder.isDirectDebit && (
                <span className="ml-2 rounded-full bg-warning/20 px-2 py-0.5 text-xs">
                  {tAnnuals("isDirectDebit")}
                </span>
              )}
            </p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              {t("annual", { month: monthName })}
            </p>
          </div>
        ))}
      </div>
    </Collapsible>
  );
}
