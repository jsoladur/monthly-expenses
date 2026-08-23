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
import { getProfileSettings } from "@/server/services/settings";
import { formatMoney, isAppLocale, monthYear } from "@/i18n/format";
import { parseAmount } from "@/server/money";
import { MonthTouchClient } from "@/app/[locale]/months/[year]/[month]/month-touch-client";

// ============================================================================
// Month workspace — UC-06 screen 4 skeleton.
//
// Renders the month header + the cloned reserved lines grouped by kind
// (PRD §7.8: months never sync with templates). Incomes (UC-07) and actuals
// (UC-08) ship in their own slices; this page surfaces their
// "coming next" placeholders so the skeleton is visible end to end.
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
  const t = await getTranslations({ locale, namespace: "months.workspace" });
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
  const committedLines = workspace.lines.filter((l) => l.kind === "committed");
  const estimatedLines = workspace.lines.filter((l) => l.kind === "estimated");

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

      <section
        aria-labelledby="reserved-committed"
        className="flex flex-col gap-2"
      >
        <h2 id="reserved-committed" className="text-base font-semibold">
          {t("reservedCommitted")}
        </h2>
        {committedLines.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noLines")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {committedLines.map((line) => (
              <li
                key={line.id}
                className="bg-card text-card-foreground flex items-center justify-between rounded-md border px-4 py-2 text-sm"
              >
                <span>{line.name}</span>
                <span className="tabular-nums">
                  {formatMoney(parseAmount(line.remainingAmount), currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="reserved-estimated"
        className="flex flex-col gap-2"
      >
        <h2 id="reserved-estimated" className="text-base font-semibold">
          {t("reservedEstimated")}
        </h2>
        {estimatedLines.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noLines")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {estimatedLines.map((line) => (
              <li
                key={line.id}
                className="bg-card text-card-foreground flex items-center justify-between rounded-md border px-4 py-2 text-sm"
              >
                <span>{line.name}</span>
                <span className="tabular-nums">
                  {formatMoney(parseAmount(line.remainingAmount), currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">{"Incomes"}</h2>
        <p className="text-muted-foreground text-sm">
          {t("incomesComingNext")}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">{"Actuals"}</h2>
        <p className="text-muted-foreground text-sm">
          {t("actualsComingNext")}
        </p>
      </section>
    </main>
  );
}
