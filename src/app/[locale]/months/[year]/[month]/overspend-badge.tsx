import { getTranslations } from "next-intl/server";
import { formatMoney } from "@/i18n/format";
import type { OverspendWarning } from "@/server/services/summary";
import { AlertTriangle } from "lucide-react";

export interface OverspendBadgeProps {
  warning: OverspendWarning;
  currency: string;
}

export async function OverspendBadge({ warning, currency }: OverspendBadgeProps) {
  const t = await getTranslations("warnings");
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="overspend-badge"
      className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-relaxed"
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
      <p>
        <span className="font-medium text-warning">{t("overspend")}</span>{" "}
        <span className="text-muted-foreground">
          {t("overspendPlan", { plan: formatMoney(warning.estimatedTemplateTotal, currency) })}
          {" · "}
          {t("overspendOver", { amount: formatMoney(warning.overrunCents, currency) })}
        </span>
      </p>
    </div>
  );
}
