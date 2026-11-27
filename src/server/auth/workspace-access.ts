import "server-only";
import { findMembership } from "@/server/repositories/workspace";
import {
  WorkspaceNotFoundError,
  authorize,
  type WorkspaceAccess,
  type WorkspaceAction,
} from "@/lib/workspace-roles";

// ============================================================================
// `loadWorkspaceAccess()` — membership + role check without a session
// (UC-31 §5.3, ARCH §3.2 rule 6).
//
// The session-aware wrapper is `requireWorkspaceAccess()`, which first calls
// `requireUserId()`. This half is separate so integration tests can build a
// `WorkspaceAccess` for a seeded user.
//
//   - not a member (or no such workspace, or a malformed id) →
//     `WorkspaceNotFoundError`: the same answer either way (UC-31 §4.8.1).
//   - member without the role for `action` → `WorkspaceForbiddenError`.
// ============================================================================

export async function loadWorkspaceAccess(
  userId: string,
  workspaceId: string,
  action: WorkspaceAction = "read",
): Promise<WorkspaceAccess> {
  const membership = await findMembership(workspaceId, userId);
  if (!membership) {
    throw new WorkspaceNotFoundError();
  }
  const access: WorkspaceAccess = {
    userId,
    workspaceId: membership.workspaceId,
    role: membership.role,
    kind: membership.kind,
  };
  authorize(access, action);
  return access;
}
