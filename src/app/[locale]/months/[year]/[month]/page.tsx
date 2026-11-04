import { notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
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
import { getAnnualReminders } from "@/server/services/annuals";
import { getEstimateCheck } from "@/server/services/estimate-check";
import { isBeforeCurrentMonth } from "@/lib/estimate-check";
import { getProfileSettings } from "@/server/services/settings";
import { listActiveCategoriesForPicker } from "@/server/services/categories";
import { listCategoriesForManagement } from "@/server/services/categories";
import { listRecentActualNameSuggestions } from "@/server/services/actuals";
import { listUpcomingMonthsForPass } from "@/server/services/pass-to-upcoming";
import { listMoveTargets, type MoveTargetMonth } from "@/server/services/move-actual";
import type { MoveTargetOption } from "@/components/move-actual-drawer";
import { isAppLocale, monthName, monthYear } from "@/i18n/format";
import { parseAmount } from "@/server/money";
import { MonthTouchClient } from "@/app/[locale]/months/[year]/[month]/month-touch-client";
import {
  type ReservedLineGroup,
  type ReservedLineRowData,
} from "@/app/[locale]/months/[year]/[month]/reserved-lines-types";
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
import { EstimateCheckPanel } from "@/app/[locale]/months/[year]/[month]/estimate-check";
import { EstimatedReservedLinesScreen } from "@/app/[locale]/months/[year]/[month]/estimated-reserved-lines-screen";
import { StatsScreen, MonthStatsHelp } from "@/app/[locale]/months/[year]/[month]/stats-screen";
import { AnnualReminderCards, type AnnualReminder } from "@/app/[locale]/months/[year]/[month]/annual-reminder-cards";
import { OverspendWarnings } from "@/app/[locale]/months/[year]/[month]/overspend-warnings";
import { AppShell } from "@/components/app-shell";
import { Link, redirect } from "@/i18n/navigation";
import { auth, signOut } from "@/auth";
import { MonthWorkspaceTabs } from "@/app/[locale]/months/[year]/[month]/month-workspace-tabs";

export default async function MonthWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; year: string; month: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { locale, year: yearStr, month: monthStr } = await params;
  const { from: fromRaw } = await searchParams;
  const from = Array.isArray(fromRaw) ? fromRaw[0] : fromRaw;
  const cameFromHistory = from === "history";
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

  const [
    summary,
    overspendWarnings,
    annualReminders,
    nameSuggestions,
    upcomingMonthsRaw,
    estimateCheck,
    moveTargetsRaw,
  ] =
    await Promise.all([
      getMonthSummary(userId, workspace.month.id),
      getOverspendWarnings(userId, workspace.month.id),
      getAnnualReminders(userId, workspace.month.month),
      listRecentActualNameSuggestions(userId, workspace.month.year, workspace.month.month),
      cameFromHistory
        ? Promise.resolve([])
        : listUpcomingMonthsForPass(userId, workspace.month.year, workspace.month.month),
      getEstimateCheck(userId, workspace.month.id),
      listMoveTargets(userId, workspace.month.id),
    ]);
  // UC-26: targets computed once per page; each carries its left-over so the
  // picker can answer "is there room?" without a per-row fetch.
  const toMoveOption = async (m: MoveTargetMonth): Promise<MoveTargetOption> => ({
    id: m.id,
    year: m.year,
    month: m.month,
    label: monthYear(locale as AppLocale, m.year, m.month),
    leftOverCents: (await getMonthSummary(userId, m.id)).potentialSavings,
    // A month before the current calendar month is closed: its figure is
    // what was saved, not a forecast.
    isPast: isBeforeCurrentMonth(m.year, m.month, new Date()),
  });
  const moveTargets = workspace.actuals.length > 0
    ? {
        previous: await Promise.all(moveTargetsRaw.previous.map(toMoveOption)),
        upcoming: await Promise.all(moveTargetsRaw.upcoming.map(toMoveOption)),
      }
    : { previous: [], upcoming: [] };
  const now = new Date();
  const showPastMonthBanner = isPastMonth(
    workspace.month.year,
    workspace.month.month,
    now,
  );
  const isBeforeCurrent = isBeforeCurrentMonth(
    workspace.month.year,
    workspace.month.month,
    now,
  );
  const flaggedEstimateCount = estimateCheck.categories.filter((c) => c.flagged).length;

  const session = await auth();
  const email = session?.user?.email ?? "";
  const displayName = session?.user?.name ?? null;
  const avatarUrl = session?.user?.image ?? null;

  const t = await getTranslations({ locale, namespace: "months.tabs" });
  const tMonths = await getTranslations({ locale, namespace: "months" });
  const tEstimate = await getTranslations({ locale, namespace: "estimateCheck" });

  const committedLines = reservedLineGroups.find((g) => g.kind === "committed")?.rows ?? [];
  const committedTotalCents = committedLines.reduce((sum, line) => sum + line.originalCents, 0);

  const reminderData: AnnualReminder[] = annualReminders.map((r) => ({
    id: r.id,
    name: r.name,
    categoryName: expenseCategoryMap.get(r.categoryId)?.name ?? "—",
    isDirectDebit: r.isDirectDebit,
    amountCents: r.amount !== null ? parseAmount(r.amount) : null,
  }));

  async function startSignOut() {
    "use server";
    await signOut({ redirectTo: `/${locale}/sign-in` });
  }

  return (
    <AppShell email={email} displayName={displayName} avatarUrl={avatarUrl} signOutAction={startSignOut}>
      <MonthTouchClient year={workspace.month.year} month={workspace.month.month} />
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-2">
          {cameFromHistory ? (
            <Link
              href={`/history/${year}`}
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              ← {tMonths("backToYear", { year })}
            </Link>
          ) : (
            <Link
              href="/"
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              ← {tMonths("backToHome")}
            </Link>
          )}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {monthYear(locale as AppLocale, workspace.month.year, workspace.month.month)}
        </h1>

        {showPastMonthBanner && <PastMonthBanner />}

        <SummaryBlock summary={summary} currency={currency} />

        {reminderData.length > 0 && (
          <AnnualReminderCards
            reminders={reminderData}
            monthName={monthYear(locale as AppLocale, workspace.month.year, workspace.month.month)}
            currency={currency}
          />
        )}

        <OverspendWarnings warnings={overspendWarnings} currency={currency} />

        <MonthWorkspaceTabs
          actualsTab={
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
              committedReservedLines={committedLines}
              nameSuggestions={nameSuggestions}
              moveTargets={moveTargets}
            />
          }
          incomesTab={
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
          }
          reservedTab={
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
              upcomingMonths={upcomingMonthsRaw.map((m) => ({
                id: m.id,
                year: m.year,
                month: m.month,
                label: monthName(locale as AppLocale, m.month),
              }))}
            />
          }
          checkTab={
            <EstimateCheckPanel
              monthId={workspace.month.id}
              year={workspace.month.year}
              month={workspace.month.month}
              currency={currency}
              check={estimateCheck}
              isPast={isBeforeCurrent}
            />
          }
          statsTab={
            <StatsScreen
              actuals={actualRows.map((r) => ({
                id: r.id,
                categoryId: r.categoryId,
                categoryName: r.categoryName,
                name: r.name,
                amountCents: r.amountCents,
                observations: r.observations,
              }))}
              reservedLines={reservedLineRows.map((r) => ({
                id: r.id,
                categoryId: r.categoryId,
                categoryName: r.categoryName,
                name: r.name,
                remainingCents: r.remainingCents,
                kind: r.kind,
                observations: r.observations,
              }))}
              savingsCategoryIds={allExpenseCategories
                .filter((c) => c.countsAsSavings)
                .map((c) => c.id)}
              investedTotalCents={summary.hasSavingsRows ? summary.investedTotal : null}
              actualsTotalCents={summary.actualsTotal}
              reservedRemainingTotalCents={summary.reservedRemainingTotal}
              committedTotalCents={committedTotalCents}
              currency={currency}
            />
          }
          helpTab={<MonthStatsHelp />}
          labels={{
            data: t("data"),
            check: t("check"),
            checkFlagged: tEstimate("flaggedCount", { count: flaggedEstimateCount }),
            stats: t("stats"),
            actuals: t("actuals"),
            incomes: t("incomes"),
            reserved: t("reserved"),
            help: t("help"),
          }}
          counts={{
            actuals: actualRows.length,
            incomes: incomeRows.length,
            reserved: reservedLineGroups.find((g) => g.kind === "estimated")?.rows.length ?? 0,
            flagged: flaggedEstimateCount,
          }}
        />
      </div>
    </AppShell>
  );
}
