import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth, signOut } from "@/auth";
import { Link, redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { AppShell } from "@/components/app-shell";
import { requireWorkspaceAccess } from "@/server/auth/require-workspace-access";
import { getWorkspaceDetails } from "@/server/services/workspaces";
import { WorkspaceNotFoundError, roleAllows } from "@/lib/workspace-roles";
import { SUPPORTED_CURRENCIES } from "@/lib/workspace-name";
import { WorkspaceDetailsScreen } from "./workspace-details-screen";

// ============================================================================
// Workspace details (UC-31 §7.2) — shared workspaces only. A private
// workspace, a workspace the user is not a member of, and a random id all
// answer the same 404 (UC-31 §4.8.1, scenario 87).
// ============================================================================

export default async function WorkspaceDetailsPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceId: string }>;
}) {
  const { locale, workspaceId } = await params;
  if (!hasLocale(routing.locales, locale)) {
    redirect({ href: "/workspaces", locale: routing.defaultLocale });
  }
  setRequestLocale(locale);

  let access;
  try {
    access = await requireWorkspaceAccess(workspaceId, "read", locale);
  } catch (err) {
    if (err instanceof WorkspaceNotFoundError) notFound();
    throw err;
  }
  if (access.kind !== "shared") notFound();

  const [details, t, session] = await Promise.all([
    getWorkspaceDetails(access),
    getTranslations({ locale, namespace: "workspaces" }),
    auth(),
  ]);

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
        <Link
          href="/workspaces"
          className="text-muted-foreground hover:text-foreground self-start text-sm transition-colors"
        >
          ← {t("back")}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{details.workspace.name}</h1>
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
            {t(`roles.${access.role}`)}
          </span>
        </div>
        <WorkspaceDetailsScreen
          workspaceId={details.workspace.id}
          name={details.workspace.name ?? ""}
          currency={details.workspace.currency}
          currencies={SUPPORTED_CURRENCIES}
          viewerId={access.userId}
          viewerRole={access.role}
          members={details.members}
          counts={details.counts}
          can={{
            manageWorkspace: roleAllows(access.role, "manageWorkspace"),
            manageMembers: roleAllows(access.role, "manageMembers"),
            leave: roleAllows(access.role, "leaveWorkspace"),
            delete: roleAllows(access.role, "deleteWorkspace"),
          }}
        />
      </div>
    </AppShell>
  );
}
