import { hasLocale } from "next-intl";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { signIn } from "@/auth";
import { LanguageSwitcher } from "@/components/language-switcher";
import { routing } from "@/i18n/routing";
import Image from "next/image";
import { SignInButton } from "./sign-in-button";

export default async function SignInPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    throw new Error("Unsupported locale segment");
  }
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "auth.signIn" });

  async function startGoogleSignIn() {
    "use server";
    await signIn("google", { redirectTo: `/${locale}` });
  }

  return (
    <main
      lang={locale}
      className="bg-background flex min-h-svh flex-col items-center justify-center gap-8 px-6"
    >
      <div className="flex flex-col items-center gap-8 text-center">
        <div className="flex flex-col items-center gap-4">
          <Image
            src="/images/logo.png"
            alt="Monthly Expenses"
            width={80}
            height={80}
            className="rounded-2xl"
          />
          <header className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
          </header>
        </div>
        <SignInButton action={startGoogleSignIn} label={t("googleButton")} />
        <div className="flex justify-center">
          <LanguageSwitcher />
        </div>
      </div>
    </main>
  );
}
