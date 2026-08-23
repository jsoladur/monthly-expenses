import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { DEFAULT_LOCALE, isSupportedLocale } from "@/i18n/load-messages";

// ============================================================================
// Home — minimal entry for UC-01.
//
// When the user reaches the app root with no locale segment we redirect them
// to the default-locale root. Signed-in users will eventually land in the
// month workspace (UC-06); for now we bounce them to the sign-in page so the
// flow is observable end to end. UC-02 owns locale resolution from the cookie
// and `Accept-Language` header.
// ============================================================================

export default async function LocaleHome({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) {
    redirect(`/${DEFAULT_LOCALE}`);
  }
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/${locale}/sign-in`);
  }
  redirect(`/${locale}/sign-in`);
}
