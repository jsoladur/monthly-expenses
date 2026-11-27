import { redirect } from "@/i18n/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth, signOut } from "@/auth";
import { resolveActiveWorkspace } from "@/server/auth/require-workspace-access";
import { getMonthList } from "@/server/services/months";
import { roleAllows } from "@/lib/workspace-roles";
import { isAppLocale, monthYear, monthName } from "@/i18n/format";
import { routing, type AppLocale } from "@/i18n/routing";
import { MonthCreateForm } from "@/app/[locale]/month-create-form";
import { CreateDrawer } from "@/components/create-drawer";
import { AppShell } from "@/components/app-shell";
import { ExportExpensesDrawer } from "@/components/export-expenses-drawer";
import { Link } from "@/i18n/navigation";
import { uniqueYearsDescending } from "@/lib/export-selection";
import { isHomeYear } from "@/lib/month-buckets";
import { Lock, Trash2 } from "lucide-react";

export default async function LocaleHome({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    deleted?: string | string[];
    madePrivate?: string | string[];
    name?: string | string[];
  }>;
}) {
  const { locale } = await params;
  const { deleted: deletedRaw, madePrivate: madePrivateRaw, name: nameRaw } = await searchParams;
  if (!isAppLocale(locale)) {
    redirect({ href: "/", locale: routing.defaultLocale });
  }
  setRequestLocale(locale);

  const access = await resolveActiveWorkspace(locale);
  const t = await getTranslations({ locale, namespace: "auth.signedIn" });
  const tm = await getTranslations({ locale, namespace: "months" });
  const tv = await getTranslations({ locale, namespace: "validation" });
  const tw = await getTranslations({ locale, namespace: "workspaces.convert.private" });

  // Home shows the active workspace's months; the workspace is picked in the
  // header switcher (UC-31 §4.12, PO decision 2026-11-27).
  const allMonths = await getMonthList(access);
  const canCreateMonth = roleAllows(access.role, "createMonth");
  // UC-27: one-shot note after a month delete (`?deleted=YYYY-M`). Shown only
  // when that period really is gone for this tenant.
  const deletedPeriod = parseDeletedPeriod(deletedRaw);
  const deletedLabel =
    deletedPeriod &&
    !allMonths.some((m) => m.year === deletedPeriod.year && m.month === deletedPeriod.month)
      ? monthYear(locale as AppLocale, deletedPeriod.year, deletedPeriod.month)
      : null;
  // UC-33: one-shot note after making a shared workspace private. Shown only
  // when the named workspace really is the active PRIVATE workspace.
  const madePrivateName =
    first(madePrivateRaw) === access.workspaceId && access.kind === "private"
      ? (first(nameRaw) ?? "").slice(0, 60)
      : null;
  // Home: current year and any later year (newest first); earlier years live
  // in History (PRD UC-14).
  const now = new Date();
  const months = allMonths.filter((m) => isHomeYear(m.year, now));
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

        {madePrivateName && (
          <p
            role="status"
            className="bg-success/10 text-foreground flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
          >
            <Lock className="text-success-foreground size-4 shrink-0" aria-hidden />
            {tw("done", { name: madePrivateName })}
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
            {canCreateMonth && (
              <CreateDrawer label={tm("create.title")} testId="new-month">
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
                    forbidden: tv("workspaceForbidden"),
                  }}
                  monthNames={monthNames}
                  existingMonths={existingMonths}
                />
              </CreateDrawer>
            )}
          </section>
        ) : (
          <section aria-labelledby="month-list" className="flex flex-col gap-4">
            {canCreateMonth && (
              <CreateDrawer label={tm("create.title")} testId="new-month">
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
                    forbidden: tv("workspaceForbidden"),
                  }}
                  monthNames={monthNames}
                  existingMonths={existingMonths}
                />
              </CreateDrawer>
            )}
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

function first(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
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
