import { getTranslations } from "next-intl/server";
import { resolveActiveWorkspace } from "@/server/auth/require-workspace-access";
import { listMyWorkspaces } from "@/server/services/workspaces";
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
  const workspaces = await listMyWorkspaces(access.userId);
  let workspace: WorkspaceSwitcherInfo | null = null;
  if (workspaces.length > 1) {
    const active = workspaces.find((w) => w.id === access.workspaceId);
    const t = await getTranslations("workspaces");
    workspace = {
      activeName: active?.kind === "shared" && active.name ? active.name : t("privateLabel"),
    };
  }
  return <AppShellClient {...props} workspace={workspace} />;
}
