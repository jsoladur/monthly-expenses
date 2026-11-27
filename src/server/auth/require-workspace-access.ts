import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { requireUserId } from "@/server/auth/require-user-id";
import { loadWorkspaceAccess } from "@/server/auth/workspace-access";
import { resolveActiveWorkspaceFor } from "@/server/services/workspaces";
import type { WorkspaceAccess, WorkspaceAction } from "@/lib/workspace-roles";

// ============================================================================
// Workspace access in the data-access layer (UC-31 §5.3, ARCH §3.2 rule 6,
// ADR-12).
//
// `requireWorkspaceAccess(workspaceId, action)` — `requireUserId()` (redirects
// to sign-in without a session), then membership + the §3 matrix. Wrapped in
// `React.cache` so a render pass checks each (workspace, action) once.
//
// `resolveActiveWorkspace()` — the workspace every section shows: the
// `active_workspace` cookie when the user is still a member, otherwise the
// user's private workspace (UC-31 §4.9). The cookie is a UX hint only; the
// membership is re-checked on every request (PRD §5.4).
// ============================================================================

export const ACTIVE_WORKSPACE_COOKIE = "active_workspace" as const;

export const requireWorkspaceAccess = cache(
  async (workspaceId: string, action: WorkspaceAction = "read", locale?: string): Promise<WorkspaceAccess> => {
    const userId = await requireUserId(locale);
    return loadWorkspaceAccess(userId, workspaceId, action);
  },
);

export const resolveActiveWorkspace = cache(async (locale?: string): Promise<WorkspaceAccess> => {
  const userId = await requireUserId(locale);
  const store = await cookies();
  const raw = store.get(ACTIVE_WORKSPACE_COOKIE)?.value;
  return resolveActiveWorkspaceFor(userId, raw);
});

export async function setActiveWorkspaceCookie(workspaceId: string): Promise<void> {
  const store = await cookies();
  store.set({
    name: ACTIVE_WORKSPACE_COOKIE,
    value: workspaceId,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function clearActiveWorkspaceCookieIf(workspaceId: string): Promise<void> {
  const store = await cookies();
  if (store.get(ACTIVE_WORKSPACE_COOKIE)?.value === workspaceId) {
    store.delete({ name: ACTIVE_WORKSPACE_COOKIE, path: "/" });
  }
}
