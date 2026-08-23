import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { auth, signOut } from "@/auth";
import { DEFAULT_LOCALE, isSupportedLocale, loadMessages } from "@/i18n/load-messages";

// ============================================================================
// Home — UC-01 minimal stub (signed-in landing).
//
// For now the home only confirms the sign-in flow is observable end to end:
// it greets the signed-in user by email and offers sign-out. The real month
// workspace (current month + month list + dashboard) ships in UC-06. The
// routing logic for the locale segment (cookie + Accept-Language + middleware)
// ships in UC-02 — for now we just trust the URL prefix.
//
// Branches:
//   - Unknown locale segment → /{DEFAULT_LOCALE}
//   - No session           → /{locale}/sign-in
//   - Session present      → render the stub below
// ============================================================================

export default async function LocaleHome({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  if (!isSupportedLocale(rawLocale)) {
    redirect(`/${DEFAULT_LOCALE}`);
  }
  const locale = rawLocale;

  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/${locale}/sign-in`);
  }

  const messages = loadMessages(locale);
  const email = session.user.email ?? "";
  const displayName = session.user.name ?? null;
  const t = messages.auth.signedIn;

  async function startSignOut() {
    "use server";
    await signOut({ redirectTo: `/${locale}/sign-in` });
  }

  return (
    <main
      lang={locale}
      className="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-6 px-6 py-12"
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t.subtitle.replace("{email}", email)}
        </p>
      </header>
      {displayName && (
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t.displayName.replace("{name}", displayName)}
        </p>
      )}
      <p className="text-muted-foreground text-sm leading-relaxed">{t.comingNext}</p>
      <form action={startSignOut}>
        <Button type="submit" variant="outline" className="w-full" size="lg">
          {t.signOut}
        </Button>
      </form>
    </main>
  );
}
