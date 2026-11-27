import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth, signOut } from "@/auth";
import { Link, redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { AppShell } from "@/components/app-shell";
import { requireWorkspaceAccess } from "@/server/auth/require-workspace-access";
import { getWorkspaceDetails, listMemberCandidates } from "@/server/services/workspaces";
import { getOfferForWorkspace } from "@/server/services/workspace-transfer";
import { getMakePrivateSummary } from "@/server/services/workspace-conversion";
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
  searchParams,
}: {
  params: Promise<{ locale: string; workspaceId: string }>;
  searchParams: Promise<{ shared?: string | string[] }>;
}) {
  const { locale, workspaceId } = await params;
  const { shared } = await searchParams;
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

  const canManageMembers = roleAllows(access.role, "manageMembers");
  const canMakePrivate = roleAllows(access.role, "convertToPrivate");
  const [details, candidates, offer, makePrivate, t, session] = await Promise.all([
    getWorkspaceDetails(access),
    canManageMembers ? listMemberCandidates(access) : Promise.resolve([]),
    getOfferForWorkspace(access),
    canMakePrivate ? getMakePrivateSummary(access) : Promise.resolve(null),
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
          invitations={details.invitations.map((i) => ({ email: i.email, role: i.role }))}
          candidates={candidates}
          offer={
            offer
              ? {
                  fromUserId: offer.fromUserId,
                  fromLabel: offer.fromLabel,
                  toUserId: offer.toUserId,
                  toLabel: offer.toLabel,
                }
              : null
          }
          transferCandidates={details.members
            .filter((m) => m.role !== "owner")
            .map((m) => ({
              userId: m.userId,
              label: m.displayName?.trim() ? m.displayName : m.email,
              email: m.email,
              role: m.role,
            }))}
          counts={details.counts}
          // UC-33 §5: one-time notice right after sharing the private workspace.
          justShared={(Array.isArray(shared) ? shared[0] : shared) === "1" && access.role === "owner"}
          makePrivate={
            makePrivate
              ? {
                  privateWorkspaceId: makePrivate.privateWorkspaceId,
                  privateCounts: makePrivate.privateCounts,
                  members: makePrivate.members.map((m) => ({
                    userId: m.userId,
                    label: m.displayName?.trim() ? m.displayName : m.email,
                    email: m.email,
                    role: m.role,
                  })),
                  invitations: makePrivate.invitations.map((i) => ({ email: i.email, role: i.role })),
                }
              : null
          }
          can={{
            manageWorkspace: roleAllows(access.role, "manageWorkspace"),
            manageMembers: canManageMembers,
            leave: roleAllows(access.role, "leaveWorkspace"),
            delete: roleAllows(access.role, "deleteWorkspace"),
          }}
        />
      </div>
    </AppShell>
  );
}
