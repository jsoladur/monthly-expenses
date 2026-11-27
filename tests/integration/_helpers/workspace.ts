import { upsertUserOnSignIn } from "@/server/services/auth";
import { ensurePrivateWorkspace } from "@/server/services/workspaces";
import { loadWorkspaceAccess } from "@/server/auth/workspace-access";
import type { WorkspaceAccess } from "@/lib/workspace-roles";

// ============================================================================
// Integration helper (UC-31): seed a signed-in user the way sign-in does
// (app_user + profile_settings + private workspace + owner membership) and
// return the Owner access to their private workspace.
//
// Services take a `WorkspaceAccess` (ARCH §5 rule 1a); in the app it comes from
// `requireWorkspaceAccess()`, which needs a session. Tests build it with
// `loadWorkspaceAccess()`, the same membership + role lookup without `auth()`.
// ============================================================================

export async function seedOwnerAccess(
  googleSub: string,
  opts: { email?: string; displayName?: string | null } = {},
): Promise<WorkspaceAccess> {
  const user = await upsertUserOnSignIn({
    googleSub,
    email: opts.email ?? `${googleSub}@example.com`,
    displayName: opts.displayName ?? null,
  });
  const workspace = await ensurePrivateWorkspace(user.id);
  return loadWorkspaceAccess(user.id, workspace.id);
}
