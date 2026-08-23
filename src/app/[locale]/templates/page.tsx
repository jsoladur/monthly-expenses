import { redirect } from "@/i18n/navigation";
import { hasLocale } from "next-intl";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { requireUserId } from "@/server/auth/require-user-id";
import { listTemplatesForManagement } from "@/server/services/templates";
import { listActiveCategoriesForPicker } from "@/server/services/categories";
import { LanguageSwitcher } from "@/components/language-switcher";
import { getProfileSettings } from "@/server/services/settings";
import { TemplatesScreen } from "./templates-screen";
import { routing } from "@/i18n/routing";

// ============================================================================
// Templates screen (UC-05, screen 7).
//
// Thin RSC shell that:
//   1. Resolves the tenant (`requireUserId()` — PRD §5.1, ARCH §3.2 rule 4).
//   2. Loads every template (active + inactive, for the management view) AND
//      the active expense categories (the picker used by the add/edit form)
//      in parallel.
//   3. Reads the current currency label so the rows can render their amounts
//      in the active locale and currency (PRD UC-15).
//   4. Hands off to the client `TemplatesScreen` for the interactive part
//      (kind tabs, add form, edit row, deactivate/reactivate buttons).
//
// Every mutation goes through a server action in `src/actions/templates.ts`
// which calls `revalidatePath("/[locale]/templates", "page")` on success —
// so the RSC re-renders with fresh data after each action.
// ============================================================================

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
  const [templates, expenseCategories, profileSettings, t, tn] = await Promise.all([
    listTemplatesForManagement(userId, undefined),
    listActiveCategoriesForPicker(userId, "expense"),
    getProfileSettings(userId),
    getTranslations({ locale, namespace: "templates" }),
    getTranslations({ locale, namespace: "nav" }),
  ]);

  const currency = profileSettings?.currency ?? "EUR";

  return (
    <main
      lang={locale}
      className="mx-auto flex min-h-svh w-full max-w-md flex-col gap-6 px-4 py-8"
    >
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <LanguageSwitcher />
      </div>
      <p className="text-muted-foreground text-sm leading-relaxed">{t("help")}</p>
      <p className="bg-muted/40 border-border/40 rounded-md border px-3 py-2 text-xs leading-relaxed">
        {t("cloneCopy")}
      </p>
      <nav className="flex flex-wrap gap-3 text-sm">
        <a className="text-muted-foreground underline-offset-4 hover:underline" href={`/${locale}`}>
          {tn("home")}
        </a>
        <a
          className="text-muted-foreground underline-offset-4 hover:underline"
          href={`/${locale}/categories`}
        >
          {tn("categories")}
        </a>
        <a
          className="text-muted-foreground underline-offset-4 hover:underline"
          href={`/${locale}/settings`}
        >
          {tn("settings")}
        </a>
      </nav>
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
    </main>
  );
}

function resolveCategoryName(
  categoryId: string,
  categories: ReadonlyArray<{ id: string; name: string }>,
): string {
  return categories.find((c) => c.id === categoryId)?.name ?? "—";
}

// `numeric(14,2)` is returned by postgres-js as a string. Convert to integer
// cents in the RSC serialization so the client component never sees raw
// wire strings — keeps ADR-5 / ARCH §8 on the domain-code side.
function amountStringToCents(amount: string): number {
  const sign = amount.startsWith("-") ? -1 : 1;
  const digits = amount.startsWith("-") ? amount.slice(1) : amount;
  const [whole, frac = "00"] = digits.split(".");
  return sign * (Number.parseInt(whole, 10) * 100 + Number.parseInt(frac.padEnd(2, "0"), 10));
}
