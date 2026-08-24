import { redirect } from "@/i18n/navigation";
import { hasLocale } from "next-intl";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireUserId } from "@/server/auth/require-user-id";
import { listTemplatesForManagement } from "@/server/services/templates";
import { listActiveCategoriesForPicker } from "@/server/services/categories";
import { getProfileSettings } from "@/server/services/settings";
import { TemplatesScreen } from "./templates-screen";
import { routing } from "@/i18n/routing";
import { AppShell } from "@/components/app-shell";
import { auth, signOut } from "@/auth";

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    redirect({ href: "/templates", locale: routing.defaultLocale });
  }
  setRequestLocale(locale);

  const userId = await requireUserId(locale);
  const [templates, expenseCategories, profileSettings, t, session] = await Promise.all([
    listTemplatesForManagement(userId, undefined),
    listActiveCategoriesForPicker(userId, "expense"),
    getProfileSettings(userId),
    getTranslations({ locale, namespace: "templates" }),
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
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <TemplatesScreen
          locale={locale}
          currency={currency}
          initialTemplates={templates.map((row) => ({
            id: row.id,
            categoryId: row.categoryId,
            categoryName: resolveCategoryName(row.categoryId, expenseCategories),
            kind: row.kind,
            name: row.name,
            observations: row.observations ?? "",
            amountCents: amountStringToCents(row.amount),
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

function amountStringToCents(amount: string): number {
  const sign = amount.startsWith("-") ? -1 : 1;
  const digits = amount.startsWith("-") ? amount.slice(1) : amount;
  const [whole, frac = "00"] = digits.split(".");
  return sign * (Number.parseInt(whole, 10) * 100 + Number.parseInt(frac.padEnd(2, "0"), 10));
}
