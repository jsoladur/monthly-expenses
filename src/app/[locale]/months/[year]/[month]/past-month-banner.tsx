import { getTranslations } from "next-intl/server";
import { Clock } from "lucide-react";

export async function PastMonthBanner() {
  const t = await getTranslations("months.summary");
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="past-month-banner"
      className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-relaxed"
    >
      <Clock className="size-3.5 shrink-0 text-warning" />
      <p className="text-muted-foreground">
        {t("pastMonthBanner")}
      </p>
    </div>
  );
}
