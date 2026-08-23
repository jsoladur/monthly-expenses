import { getTranslations } from "next-intl/server";
import { formatMoney } from "@/i18n/format";
import type { OverspendWarning } from "@/server/services/summary";

// ============================================================================
// Overspend badge (UC-11, PRD §7.4 / C18 / #19).
//
// Inline notification rendered next to category rows that have
// `actuals > active estimated templates` (LEFT > RIGHT). The badge never
// blocks — it's an informational warning only (PRD §7.4).
//
// The component takes the rendered `categoryId` so the caller can place it
// inline (the parent renders one badge per overspending category, attached
// to the row's heading / category name).
//
// The component is an async server component so it can use
// `getTranslations` server-side (next-intl) without bundling translations
// into the client.
// ============================================================================

export interface OverspendBadgeProps {
  warning: OverspendWarning;
  currency: string;
}

export async function OverspendBadge({ warning, currency }: OverspendBadgeProps) {
  const t = await getTranslations("warnings");
  return (
    <p
      role="status"
      aria-live="polite"
      data-testid="overspend-badge"
      className="bg-muted/40 border-border/40 rounded-md border px-2 py-1 text-xs leading-relaxed"
    >
      <span className="font-medium">{t("overspend")}</span>{" "}
      <span className="text-muted-foreground">
        {t("overspendPlan", { plan: formatMoney(warning.estimatedTemplateTotal, currency) })}
        {" · "}
        {t("overspendOver", { amount: formatMoney(warning.overrunCents, currency) })}
      </span>
    </p>
  );
}