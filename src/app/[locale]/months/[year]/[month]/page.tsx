import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { LanguageSwitcher } from "@/components/language-switcher";
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
import { EstimatedReservedLinesScreen } from "@/app/[locale]/months/[year]/[month]/estimated-reserved-lines-screen";
import { AppShell } from "@/components/app-shell";
import { redirect } from "@/i18n/navigation";

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

  let workspace;
  try {
    workspace = await getMonthWorkspace(userId, year, month);
  } catch (err) {
    if (err instanceof MonthNotFoundError) notFound();
    throw err;
  }

  const settings = await getProfileSettings(userId);
  const currency = settings?.currency ?? "EUR";

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
    <AppShell>
      <MonthTouchClient year={workspace.month.year} month={workspace.month.month} />
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">
            {monthYear(locale as AppLocale, workspace.month.year, workspace.month.month)}
          </h1>
          <LanguageSwitcher />
        </div>

        {showPastMonthBanner && <PastMonthBanner />}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8" style={{
          gridTemplateAreas: `
            "summary"
            "actuals"
            "reserved"
            "incomes"
          `,
        }}>
          <div className="max-lg:order-1 lg:[grid-area:summary]">
            <SummaryBlock summary={summary} currency={currency} />
          </div>

          <div className="max-lg:order-2 lg:[grid-area:actuals]">
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
              committedReservedLines={reservedLineGroups.find((g) => g.kind === "committed")?.rows ?? []}
            />
          </div>

          <div className="max-lg:order-3 lg:[grid-area:reserved]">
            <EstimatedReservedLinesScreen
              monthId={workspace.month.id}
              year={workspace.month.year}
              month={workspace.month.month}
              currency={currency}
              rows={reservedLineGroups.find((g) => g.kind === "estimated")?.rows ?? []}
              expenseCategories={activeExpenseCategories.map((c) => ({
                id: c.id,
                name: c.name,
              }))}
            />
          </div>

          <div className="max-lg:order-4 lg:[grid-area:incomes]">
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
          </div>
        </div>
      </div>
    </AppShell>
  );
}
