import { redirect } from "@/i18n/navigation";
import { hasLocale } from "next-intl";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireUserId } from "@/server/auth/require-user-id";
import { listAnnualsForManagement } from "@/server/services/annuals";
import { listActiveCategoriesForPicker } from "@/server/services/categories";
import { getProfileSettings } from "@/server/services/settings";
import { parseAmount } from "@/server/money";
import { AnnualsScreen } from "./annuals-screen";
import { routing } from "@/i18n/routing";
import { AppShell } from "@/components/app-shell";
import { auth, signOut } from "@/auth";

export default async function AnnualsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    redirect({ href: "/annuals", locale: routing.defaultLocale });
  }
  setRequestLocale(locale);

  const userId = await requireUserId(locale);
  const [annuals, expenseCategories, profileSettings, t, session] = await Promise.all([
    listAnnualsForManagement(userId),
    listActiveCategoriesForPicker(userId, "expense"),
    getProfileSettings(userId),
    getTranslations({ locale, namespace: "annuals" }),
    auth(),
  ]);

  const currency = profileSettings?.currency ?? "EUR";
  const email = session?.user?.email ?? "";
  const displayName = session?.user?.name ?? null;
  const avatarUrl = session?.user?.image ?? null;

  async function startSignOut() {
    "use server";
    await signOut({ redirectTo: `/${locale}/sign-in` });
  }

  return (
    <AppShell email={email} displayName={displayName} avatarUrl={avatarUrl} signOutAction={startSignOut}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
        <AnnualsScreen
          locale={locale}
          currency={currency}
          initialAnnuals={annuals.map((row) => ({
            id: row.id,
            categoryId: row.categoryId,
            categoryName: resolveCategoryName(row.categoryId, expenseCategories),
            name: row.name,
            observations: row.observations ?? "",
            amountCents: row.amount !== null ? parseAmount(row.amount) : null,
            chargeMonth: row.chargeMonth,
            isDirectDebit: row.isDirectDebit,
            active: row.active,
          }))}
          expenseCategories={expenseCategories.map((row) => ({ id: row.id, name: row.name }))}
        />
      </div>
    </AppShell>
  );
}

function resolveCategoryName(
  categoryId: string,
  categories: ReadonlyArray<{ id: string; name: string }>,
): string {
  return categories.find((c) => c.id === categoryId)?.name ?? "—";
}
