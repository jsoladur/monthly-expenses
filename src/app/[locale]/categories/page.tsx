import { redirect } from "@/i18n/navigation";
import { hasLocale } from "next-intl";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireUserId } from "@/server/auth/require-user-id";
import {
  listCategoriesForManagement,
} from "@/server/services/categories";
import { CategoriesScreen } from "./categories-screen";
import { routing } from "@/i18n/routing";
import { AppShell } from "@/components/app-shell";
import { auth, signOut } from "@/auth";

export default async function CategoriesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    redirect({ href: "/categories", locale: routing.defaultLocale });
  }
  setRequestLocale(locale);

  const userId = await requireUserId(locale);
  const [expenseCategories, incomeCategories, t, session] = await Promise.all([
    listCategoriesForManagement(userId, "expense"),
    listCategoriesForManagement(userId, "income"),
    getTranslations({ locale, namespace: "categories" }),
    auth(),
  ]);

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
        <CategoriesScreen
          locale={locale}
          initialExpense={expenseCategories.map(serializeCategory)}
          initialIncome={incomeCategories.map(serializeCategory)}
        />
      </div>
    </AppShell>
  );
}

interface SerializedCategory {
  id: string;
  name: string;
  active: boolean;
}

function serializeCategory(row: {
  id: string;
  name: string;
  active: boolean;
}): SerializedCategory {
  return { id: row.id, name: row.name, active: row.active };
}
