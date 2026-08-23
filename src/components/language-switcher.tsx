"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { routing, type AppLocale } from "@/i18n/routing";

// ============================================================================
// Language switcher (UC-02, PRD §5.4, PRD §11, ARCH §7).
//
// Two `<Link>`s, one per supported locale, rendered as a segmented control.
// The current locale is the one rendered without a hyperlink (or with
// `aria-current="page"`), so screen readers and the visual design agree.
//
// The next-intl `<Link>` with the `locale` prop:
//   - Forces the locale prefix on the generated href (so the URL becomes
//     `/es/...` even if the current locale is the default).
//   - The middleware sees that prefix, sets `NEXT_LOCALE` to match, and
//     the new locale becomes sticky for future reloads (PRD §5.4).
//
// No server action is needed; the cookie persistence is the middleware's
// responsibility, not the switcher's.
// ============================================================================

export function LanguageSwitcher() {
  const t = useTranslations("language");
  const current = useLocale() as AppLocale;
  const pathname = usePathname();

  return (
    <nav aria-label={t("label")} className="flex items-center gap-1 text-xs">
      {routing.locales.map((locale) => {
        const isCurrent = locale === current;
        return (
          <Link
            key={locale}
            href={pathname}
            locale={locale}
            aria-current={isCurrent ? "true" : undefined}
            className={
              "rounded-md px-2 py-1 font-medium uppercase tracking-wide transition-colors " +
              (isCurrent
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground")
            }
          >
            {t(`option.${locale}`)}
          </Link>
        );
      })}
    </nav>
  );
}
