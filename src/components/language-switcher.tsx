"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { routing, type AppLocale } from "@/i18n/routing";

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
                ? "bg-primary text-primary-foreground"
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
