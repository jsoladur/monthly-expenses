import { hasLocale } from "next-intl";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/language-switcher";
import { routing } from "@/i18n/routing";
import Image from "next/image";

export default async function ForbiddenPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    throw new Error("Unsupported locale segment");
  }
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "auth.forbidden" });

  return (
    <main
      lang={locale}
      className="bg-background flex min-h-svh flex-col items-center justify-center gap-8 px-6"
    >
      <div className="flex flex-col items-center gap-6 text-center">
        <Image
          src="/images/logo.png"
          alt="Monthly Expenses"
          width={80}
          height={80}
          className="rounded-2xl"
        />
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground text-base leading-relaxed max-w-sm">
            {t("body")}
          </p>
        </header>
        <Link
          href="/sign-in"
          className="text-primary text-sm font-medium underline-offset-4 hover:underline"
        >
          {t("returnHome")}
        </Link>
      </div>
      <div className="flex justify-center">
        <LanguageSwitcher />
      </div>
    </main>
  );
}
