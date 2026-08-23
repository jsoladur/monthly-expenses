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

// ============================================================================
// Categories management screen (UC-03, screens 5–6).
//
// One screen with expense/income tabs: list, create, rename,
// deactivate/reactivate. The page is a thin RSC shell that:
//   1. Resolves the tenant (`requireUserId()` — PRD §5.1, ARCH §3.2 rule 4).
//   2. Loads both kinds in parallel (one DB round-trip per query is fine for
//      the management screen; the picker half of UC-03 is a separate
//      `listActiveCategoriesForPicker` that later slices — UC-05, UC-08 —
//      will call inside their own transaction).
//   3. Hands the rows to the client `CategoriesScreen` for the interactive
//      part (tabs, add form, rename row, deactivate/reactivate buttons).
//
// Every mutation goes through a server action in `src/actions/categories.ts`
// which calls `revalidatePath("/[locale]/categories", "page")` on success —
// so the RSC re-renders with fresh data after each action.
// ============================================================================

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
    <main
      lang={locale}
      className="mx-auto flex min-h-svh w-full max-w-md flex-col gap-6 px-4 py-8"
    >
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
    </main>
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
