"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Collapsible } from "@/components/ui/collapsible";
import { OverspendBadge } from "@/app/[locale]/months/[year]/[month]/overspend-badge";
import type { OverspendWarning } from "@/server/services/summary";

export function OverspendWarnings({
  warnings,
  currency,
}: {
  warnings: OverspendWarning[];
  currency: string;
}) {
  const t = useTranslations("warnings");

  if (warnings.length === 0) {
    return null;
  }

  return (
    <Collapsible
      title={
        <span className="flex items-center gap-2">
          <AlertTriangle className="text-warning size-4" />
          {t("title")}
        </span>
      }
      count={warnings.length}
      variant="warning"
    >
      <div className="flex flex-col gap-1">
        {warnings.map((warning) => (
          <OverspendBadge
            key={warning.categoryId}
            warning={warning}
            currency={currency}
          />
        ))}
      </div>
    </Collapsible>
  );
}
