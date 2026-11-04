import { redirect } from "@/i18n/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth, signOut } from "@/auth";
import { requireUserId } from "@/server/auth/require-user-id";
import { getMonthList } from "@/server/services/months";
import { isAppLocale, monthYear, monthName } from "@/i18n/format";
import { routing, type AppLocale } from "@/i18n/routing";
import { MonthCreateForm } from "@/app/[locale]/month-create-form";
import { AppShell } from "@/components/app-shell";
import { ExportExpensesDrawer } from "@/components/export-expenses-drawer";
import { Link } from "@/i18n/navigation";
import { uniqueYearsDescending } from "@/lib/export-selection";
import { Trash2 } from "lucide-react";

export default async function LocaleHome({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ deleted?: string | string[] }>;
}) {
  const { locale } = await params;
  const { deleted: deletedRaw } = await searchParams;
  if (!isAppLocale(locale)) {
    redirect({ href: "/", locale: routing.defaultLocale });
  }
  setRequestLocale(locale);

  const userId = await requireUserId(locale);
  const t = await getTranslations({ locale, namespace: "auth.signedIn" });
  const tm = await getTranslations({ locale, namespace: "months" });
  const tv = await getTranslations({ locale, namespace: "validation" });

  const allMonths = await getMonthList(userId);
  // UC-27: one-shot note after a month delete (`?deleted=YYYY-M`). Shown only
  // when that period really is gone for this tenant.
  const deletedPeriod = parseDeletedPeriod(deletedRaw);
  const deletedLabel =
    deletedPeriod &&
    !allMonths.some((m) => m.year === deletedPeriod.year && m.month === deletedPeriod.month)
      ? monthYear(locale as AppLocale, deletedPeriod.year, deletedPeriod.month)
      : null;
  const currentYear = new Date().getFullYear();
  const months = allMonths.filter((m) => m.year === currentYear);
  const session = await auth();
  const email = session?.user?.email ?? "";
  const displayName = session?.user?.name ?? null;
  const avatarUrl = session?.user?.image ?? null;
  const monthNames = Array.from({ length: 12 }, (_, i) => monthName(locale as AppLocale, i + 1));
  const existingMonths = allMonths.map((m) => ({ year: m.year, month: m.month }));
  const exportYears = uniqueYearsDescending(existingMonths);
  const exportMonths = allMonths.map((m) => ({
    year: m.year,
    month: m.month,
    label: monthYear(locale as AppLocale, m.year, m.month),
  }));

  async function startSignOut() {
    "use server";
    await signOut({ redirectTo: `/${locale}/sign-in` });
  }

  return (
    <AppShell email={email} displayName={displayName} avatarUrl={avatarUrl} signOutAction={startSignOut}>
      <div className="flex flex-col gap-6">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <ExportExpensesDrawer years={exportYears} months={exportMonths} />
        </div>

        {deletedLabel && (
          <p
            role="status"
            className="bg-muted/60 text-foreground flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
          >
            <Trash2 className="text-muted-foreground size-4 shrink-0" aria-hidden />
            {tm("delete.done", { month: deletedLabel })}
          </p>
        )}

        {months.length === 0 ? (
          <section
            aria-labelledby="empty-months"
            className="bg-card text-card-foreground flex flex-col gap-4 rounded-lg border p-6"
          >
            <div className="flex flex-col gap-2">
              <h2 id="empty-months" className="text-lg font-semibold">
                {tm("empty.title")}
              </h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {tm("empty.body")}
              </p>
            </div>
            <MonthCreateForm
              locale={locale}
              labels={{
                year: tm("create.year"),
                month: tm("create.month"),
                submit: tm("create.submit"),
                duplicate: tm("create.duplicate"),
                validationRequired: tv("required"),
                validationMonth: tv("monthInvalid"),
                validationYear: tv("yearOutOfRange"),
              }}
              monthNames={monthNames}
              existingMonths={existingMonths}
            />
          </section>
        ) : (
          <section aria-labelledby="month-list" className="flex flex-col gap-4">
            <details className="bg-card text-card-foreground rounded-lg border">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
                {tm("list.createNew")}
              </summary>
              <div className="border-t p-4">
                <MonthCreateForm
                  locale={locale}
                  labels={{
                    year: tm("create.year"),
                    month: tm("create.month"),
                    submit: tm("create.submit"),
                    duplicate: tm("create.duplicate"),
                    validationRequired: tv("required"),
                    validationMonth: tv("monthInvalid"),
                    validationYear: tv("yearOutOfRange"),
                  }}
                  monthNames={monthNames}
                  existingMonths={existingMonths}
                />
              </div>
            </details>
            <h2 id="month-list" className="text-lg font-semibold">
              {tm("list.title")}
            </h2>
            <ul className="flex flex-col gap-2">
              {months.map((m) => (
                <li key={m.id}>
                  <Link
                    href={`/months/${m.year}/${m.month}`}
                    className="bg-card text-card-foreground hover:bg-accent flex items-center justify-between rounded-lg border px-4 py-3 text-sm font-medium transition-colors"
                  >
                    <span>{monthYear(locale as AppLocale, m.year, m.month)}</span>
                    <span className="text-muted-foreground" aria-hidden="true">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </AppShell>
  );
}

function parseDeletedPeriod(raw: string | string[] | undefined): { year: number; month: number } | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const match = value ? /^(\d{4})-(\d{1,2})$/.exec(value) : null;
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 1970 || month < 1 || month > 12) return null;
  return { year, month };
}
