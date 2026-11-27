import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ChevronRight } from "lucide-react";
import { auth, signOut } from "@/auth";
import { Link, redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { AppShell } from "@/components/app-shell";
import {
  requireWorkspaceAccess,
  resolveActiveWorkspace,
} from "@/server/auth/require-workspace-access";
import { getShareSummary } from "@/server/services/workspace-conversion";
import { listMyWorkspaces } from "@/server/services/workspaces";
import { listOffersForUser } from "@/server/services/workspace-transfer";
import { getProfileSettings } from "@/server/services/settings";
import { SUPPORTED_CURRENCIES } from "@/lib/workspace-name";
import { CreateWorkspaceForm } from "./create-workspace-form";
import { CreateDrawer } from "@/components/create-drawer";
import { ShareWorkspaceFlow } from "./convert-workspace";

// ============================================================================
// Workspaces screen (UC-31 §7.2): the user's workspaces + the create-shared
// form. Its own section in every mode: desktop sidebar, mobile More sheet,
// the Home list (multi-workspace) and a link row in Settings. The private
// row offers "Share this workspace" (UC-33 §5).
// ============================================================================

export default async function WorkspacesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    redirect({ href: "/workspaces", locale: routing.defaultLocale });
  }
  setRequestLocale(locale);

  const access = await resolveActiveWorkspace(locale);
  const [workspaces, offers, profile, t, session] = await Promise.all([
    listMyWorkspaces(access.userId),
    listOffersForUser(access.userId),
    getProfileSettings(access.userId),
    getTranslations({ locale, namespace: "workspaces" }),
    auth(),
  ]);
  if (workspaces.length === 0) notFound();
  const offered = new Set(offers.map((o) => o.workspaceId));
  // UC-33: the user is always the Owner of their private workspace.
  const privateWorkspace = workspaces.find((w) => w.kind === "private") ?? null;
  const shareSummary = privateWorkspace
    ? await getShareSummary(await requireWorkspaceAccess(privateWorkspace.id, "read", locale))
    : null;

  async function startSignOut() {
    "use server";
    await signOut({ redirectTo: `/${locale}/sign-in` });
  }

  return (
    <AppShell
      email={session?.user?.email ?? ""}
      displayName={session?.user?.name ?? null}
      avatarUrl={session?.user?.image ?? null}
      signOutAction={startSignOut}
    >
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground max-w-prose text-sm leading-relaxed">{t("lead")}</p>

        <div id="create" className="flex scroll-mt-24 justify-end">
          <CreateDrawer label={t("new")} testId="new-workspace" openOnHash="create">
            <CreateWorkspaceForm
              defaultCurrency={profile?.currency ?? "EUR"}
              currencies={SUPPORTED_CURRENCIES}
            />
          </CreateDrawer>
        </div>

        <ul className="flex flex-col gap-2">
          {workspaces.map((w) => {
            const label = w.kind === "private" ? t("privateLabel") : (w.name ?? "");
            const meta = (
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{label}</span>
                <span className="text-muted-foreground text-xs">
                  {w.kind === "shared" ? t("shared") : t("privateTag")} · {w.currency}
                  {w.id === access.workspaceId ? ` · ${t("active")}` : ""}
                </span>
                {offered.has(w.id) && (
                  <span className="text-one-off text-xs font-medium">{t("transfer.incomingBadge")}</span>
                )}
              </span>
            );
            return (
              <li key={w.id}>
                {w.kind === "shared" ? (
                  <Link
                    href={`/workspaces/${w.id}`}
                    className="bg-card text-card-foreground hover:bg-accent flex min-h-11 items-center gap-3 rounded-lg border px-4 py-3 transition-colors"
                  >
                    {meta}
                    <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-xs">
                      {t(`roles.${w.role}`)}
                    </span>
                    <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
                  </Link>
                ) : (
                  <div className="bg-card text-card-foreground flex min-h-11 flex-wrap items-center gap-3 rounded-lg border px-4 py-3">
                    {meta}
                    {shareSummary && (
                      <ShareWorkspaceFlow workspaceId={w.id} counts={shareSummary.counts} />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

      </div>
    </AppShell>
  );
}
