import { getTranslations } from "next-intl/server";

// ============================================================================
// Past-month banner (UC-11, PRD §7.7 / C8 / UC-13).
//
// Pure presentation: rendered by the RSC parent when `isPastMonth` returns
// true. Edits are still allowed (PRD §7.7), so this banner is a
// notification only — "Changes are allowed." (PRD §19 copy).
// ============================================================================

export async function PastMonthBanner() {
  const t = await getTranslations("months.summary");
  return (
    <p
      role="status"
      aria-live="polite"
      data-testid="past-month-banner"
      className="bg-muted/40 border-border/40 rounded-md border px-3 py-2 text-xs leading-relaxed"
    >
      {t("pastMonthBanner")}
    </p>
  );
}