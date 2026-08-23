import { redirect } from "@/i18n/navigation";
import { hasLocale } from "next-intl";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireUserId } from "@/server/auth/require-user-id";
import {
  listCategoriesForManagement,
} from "@/server/services/categories";
import { LanguageSwitcher } from "@/components/language-switcher";
import { CategoriesScreen } from "./categories-screen";
import { routing } from "@/i18n/routing";
import { AppShell } from "@/components/app-shell";

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
  const [expenseCategories, incomeCategories, t] = await Promise.all([
    listCategoriesForManagement(userId, "expense"),
    listCategoriesForManagement(userId, "income"),
    getTranslations({ locale, namespace: "categories" }),
  ]);

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <LanguageSwitcher />
        </div>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t("help")}
        </p>
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
