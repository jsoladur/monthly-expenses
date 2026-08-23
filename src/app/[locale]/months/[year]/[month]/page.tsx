import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Link, redirect } from "@/i18n/navigation";
import { routing, type AppLocale } from "@/i18n/routing";
import { requireUserId } from "@/server/auth/require-user-id";
import {
  getMonthWorkspace,
  MonthNotFoundError,
} from "@/server/services/months";
import {
  getMonthSummary,
  getOverspendWarnings,
  isPastMonth,
} from "@/server/services/summary";
import { getProfileSettings } from "@/server/services/settings";
import { listActiveCategoriesForPicker } from "@/server/services/categories";
import { listCategoriesForManagement } from "@/server/services/categories";
import { isAppLocale, monthYear } from "@/i18n/format";
import { parseAmount } from "@/server/money";
import { MonthTouchClient } from "@/app/[locale]/months/[year]/[month]/month-touch-client";
import {
  ReservedLinesScreen,
  type ReservedLineGroup,
  type ReservedLineRowData,
} from "@/app/[locale]/months/[year]/[month]/reserved-lines-screen";
import {
  IncomesScreen,
  type IncomeRowData,
} from "@/app/[locale]/months/[year]/[month]/incomes-screen";
import {
  ActualsScreen,
  type ActualRowData,
} from "@/app/[locale]/months/[year]/[month]/actuals-screen";
import { SummaryBlock } from "@/app/[locale]/months/[year]/[month]/summary-block";
import { PastMonthBanner } from "@/app/[locale]/months/[year]/[month]/past-month-banner";

// ============================================================================
// Month workspace — UC-06 screen 4 (full) + UC-11 summary header.
//
// Renders the month header + summary header (UC-11) + past-month banner
// (PRD §7.7) + reserved lines (UC-09) grouped by kind, then incomes
// (UC-07), then actuals (UC-08). Months never sync with templates or
// other months after creation (PRD §7.8); the `month_fixed_line` rows
// this page reads are the snapshot UC-06 cloned at create time, plus any
// month-only lines the user has added since (UC-09).
//
// The summary block (UC-11) reads `month_income`, `month_actual_expense`
// and `month_fixed_line.remaining_amount` via `getMonthSummary(userId,
// monthId)` — integer-cents algebra per ADR-5 / ARCH §8. The overspend
// warnings are computed from the user's ACTIVE estimated templates and
// the open month's actual tickets (PRD §7.4 / C18). Warnings are passed
// into the actuals + reserved-lines screens so the badge surfaces inline
// on the affected category rows.
//
// Opening a month sets the `last_opened_month` cookie (PRD §5.4, ARCH §7)
// so the home page can resume it on next visit (PRD UC-14). The cookie is
// a UX hint, NOT a security boundary — the canonical tenancy check is
// `requireUserId()` and the cookie value is re-validated against the DB
// before redirect.
//
// Money rendering: amounts arrive as `numeric(14,2)` strings from the DB.
// We convert to cents via `parseAmount` and label with `formatMoney` so the
// display side mirrors the wire format (PRD C9, §7.6, §11).
// ============================================================================

export default async function MonthWorkspacePage({
  params,
}: {
  params: Promise<{ locale: string; year: string; month: string }>;
}) {
  const { locale, year: yearStr, month: monthStr } = await params;
  if (!isAppLocale(locale)) {
    redirect({ href: "/", locale: routing.defaultLocale });
  }
  setRequestLocale(locale);

  const year = Number.parseInt(yearStr, 10);
  const month = Number.parseInt(monthStr, 10);
  if (!Number.isInteger(year) || year < 1970 || year > 9999) notFound();
  if (!Number.isInteger(month) || month < 1 || month > 12) notFound();

  const userId = await requireUserId(locale);
  const tn = await getTranslations({ locale, namespace: "nav" });

  let workspace;
  try {
    workspace = await getMonthWorkspace(userId, year, month);
  } catch (err) {
    if (err instanceof MonthNotFoundError) notFound();
    throw err;
  }

  // Persist the resume cookie on every successful open (PRD UC-14, §5.4).
  // Next.js 16 forbids cookie writes from RSC — see `MonthTouchClient` for
  // the client-side write that mirrors this intent.

  const settings = await getProfileSettings(userId);
  const currency = settings?.currency ?? "EUR";

  // Income categories: ACTIVE for the picker (PRD §6.5) + ALL for the
  // historical-row lookup (so an income whose category was later deactivated
  // still renders the category name + an inactive note).
  // Expense categories: same shape, for the actuals block (UC-08, PRD §6.7)
  // AND the reserved-lines block (UC-09, PRD §6.6).
  const [
    activeIncomeCategories,
    allIncomeCategories,
    activeExpenseCategories,
    allExpenseCategories,
  ] = await Promise.all([
    listActiveCategoriesForPicker(userId, "income"),
    listCategoriesForManagement(userId, "income"),
    listActiveCategoriesForPicker(userId, "expense"),
    listCategoriesForManagement(userId, "expense"),
  ]);
  const incomeCategoryMap = new Map(
    allIncomeCategories.map((c) => [c.id, { name: c.name, active: c.active }]),
  );
  const expenseCategoryMap = new Map(
    allExpenseCategories.map((c) => [c.id, { name: c.name, active: c.active }]),
  );
  const incomeRows: IncomeRowData[] = workspace.incomes.map((income) => {
    const meta = incomeCategoryMap.get(income.categoryId);
    return {
      id: income.id,
      categoryId: income.categoryId,
      categoryName: meta?.name ?? "—",
      categoryActive: meta?.active ?? false,
      name: income.name,
      amountCents: parseAmount(income.amount),
    };
  });
  const actualRows: ActualRowData[] = workspace.actuals.map((actual) => {
    const meta = expenseCategoryMap.get(actual.categoryId);
    return {
      id: actual.id,
      categoryId: actual.categoryId,
      categoryName: meta?.name ?? "—",
      categoryActive: meta?.active ?? false,
      name: actual.name,
      observations: actual.observations,
      amountCents: parseAmount(actual.amount),
      convertedFromLineId: actual.convertedFromLineId,
      editedAfterConversion: actual.editedAfterConversion,
    };
  });
  const reservedLineRows: ReservedLineRowData[] = workspace.lines.map((line) => {
    const meta = expenseCategoryMap.get(line.categoryId);
    return {
      id: line.id,
      categoryId: line.categoryId,
      categoryName: meta?.name ?? "—",
      categoryActive: meta?.active ?? false,
      name: line.name,
      observations: line.observations,
      remainingCents: parseAmount(line.remainingAmount),
      originalCents: parseAmount(line.originalAmount),
      kind: line.kind,
      origin: line.origin,
    };
  });
  // Group rows by kind (committed / estimated) and order clones before
  // month-only lines so the snapshot reads as "what the template said"
  // followed by "what I added on top" (PRD §7.8 / §6.6).
  const orderRows = (rows: ReservedLineRowData[]): ReservedLineRowData[] => {
    return [...rows].sort((a, b) => {
      if (a.origin !== b.origin) {
        return a.origin === "cloned" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  };
  const reservedLineGroups: ReservedLineGroup[] = (
    ["committed", "estimated"] as const
  ).map((kind) => ({
    kind,
    rows: orderRows(reservedLineRows.filter((r) => r.kind === kind)),
  }));

  // UC-11: load the savings algebra + per-category overspend warnings. Both
  // are pure reads (no transactions, no mutation), so we run them in parallel
  // with each other and with the workspace data we already loaded above.
  const [summary, overspendWarnings] = await Promise.all([
    getMonthSummary(userId, workspace.month.id),
    getOverspendWarnings(userId, workspace.month.id),
  ]);
  const now = new Date();
  const showPastMonthBanner = isPastMonth(
    workspace.month.year,
    workspace.month.month,
    now,
  );

  return (
    <main
      lang={locale}
      className="mx-auto flex min-h-svh w-full max-w-md flex-col gap-6 px-6 py-12"
    >
      <MonthTouchClient year={workspace.month.year} month={workspace.month.month} />
      <div className="flex justify-end">
        <LanguageSwitcher />
      </div>
      <header className="flex flex-col gap-2">
        <Link href="/" className="text-muted-foreground text-sm">
          ← {tn("home")}
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">
          {monthYear(locale as AppLocale, workspace.month.year, workspace.month.month)}
        </h1>
      </header>

      {showPastMonthBanner && <PastMonthBanner />}

      <SummaryBlock summary={summary} currency={currency} />

      <ReservedLinesScreen
        monthId={workspace.month.id}
        year={workspace.month.year}
        month={workspace.month.month}
        currency={currency}
        groups={reservedLineGroups}
        expenseCategories={activeExpenseCategories.map((c) => ({
          id: c.id,
          name: c.name,
        }))}
        overspendWarnings={overspendWarnings}
      />

      <IncomesScreen
        monthId={workspace.month.id}
        year={workspace.month.year}
        month={workspace.month.month}
        currency={currency}
        initialIncomes={incomeRows}
        incomeCategories={activeIncomeCategories.map((c) => ({
          id: c.id,
          name: c.name,
        }))}
      />

      <ActualsScreen
        monthId={workspace.month.id}
        year={workspace.month.year}
        month={workspace.month.month}
        currency={currency}
        initialActuals={actualRows}
        expenseCategories={activeExpenseCategories.map((c) => ({
          id: c.id,
          name: c.name,
        }))}
        overspendWarnings={overspendWarnings}
      />
    </main>
  );
}
