import { resolveActiveWorkspace } from "@/server/auth/require-workspace-access";
import { listMyWorkspaces } from "@/server/services/workspaces";
import { listOffersForUser } from "@/server/services/workspace-transfer";
import {
  AppShellClient,
  type AppShellProps,
  type WorkspaceSwitcherInfo,
} from "@/components/app-shell-client";

// ============================================================================
// App shell — server wrapper (UC-31 §4.11–§4.12).
//
// Loads the user's workspaces once per render (both calls are `React.cache`d
// or cheap) and hands the client shell the switcher info ONLY when the user
// belongs to more than one workspace. With a single (private) workspace the
// shell renders exactly as before: no chip, no Workspaces nav entry.
// ============================================================================

export async function AppShell(props: AppShellProps) {
  const access = await resolveActiveWorkspace();
  const [workspaces, offers] = await Promise.all([
    listMyWorkspaces(access.userId),
    listOffersForUser(access.userId),
  ]);
  const offered = new Set(offers.map((o) => o.workspaceId));
  let workspace: WorkspaceSwitcherInfo | null = null;
  if (workspaces.length > 1) {
    workspace = {
      activeId: access.workspaceId,
      workspaces: workspaces.map((w) => ({
        id: w.id,
        kind: w.kind,
        name: w.name,
        role: w.role,
        // UC-32: an ownership offer waits for this user here.
        ownershipOffered: offered.has(w.id),
      })),
    };
  }
  return <AppShellClient {...props} workspace={workspace} />;
}
