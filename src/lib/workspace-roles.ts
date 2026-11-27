// ============================================================================
// Workspace roles — the UC-31 §3 permission matrix (PRD C31, ARCH ADR-12).
//
// Pure: no I/O, importable from server and client code. The server enforces
// it in the service layer via `authorize()`; the UI only uses `roleAllows()`
// to hide controls a role cannot use (UC-31 §3, §7.4).
// ============================================================================

export const WORKSPACE_ROLES = ["owner", "admin", "editor", "reader"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/** Roles that can be given through the members screen. Never Owner (UC-31 §3). */
export const ASSIGNABLE_ROLES = ["reader", "editor", "admin"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export type WorkspaceKind = "private" | "shared";

export const WORKSPACE_ACTIONS = [
  "read",
  "createMonth",
  "deleteMonth",
  "createCategory",
  "manageCategories",
  "addActual",
  // Edit / delete ANY ticket. The Editor own-only rule is `canEditActual`.
  "editActual",
  "moveActual",
  "undoPass",
  // Incomes, reserved lines (add, edit remaining, delete, pass to actual),
  // estimate check, pass to upcoming month.
  "manageMonthMoney",
  "manageTemplates",
  "manageAnnuals",
  // Rename workspace, change workspace currency.
  "manageWorkspace",
  "manageMembers",
  "leaveWorkspace",
  "deleteWorkspace",
  "transferOwnership",
  // UC-33: share my private workspace / make a shared one my private one.
  "convertToShared",
  "convertToPrivate",
] as const;
export type WorkspaceAction = (typeof WORKSPACE_ACTIONS)[number];

const ALL: readonly WorkspaceRole[] = ["reader", "editor", "admin", "owner"];
const WRITERS: readonly WorkspaceRole[] = ["editor", "admin", "owner"];
const ADMINS: readonly WorkspaceRole[] = ["admin", "owner"];
const OWNER: readonly WorkspaceRole[] = ["owner"];

const MATRIX: Record<WorkspaceAction, readonly WorkspaceRole[]> = {
  read: ALL,
  createMonth: WRITERS,
  deleteMonth: ADMINS,
  createCategory: WRITERS,
  manageCategories: ADMINS,
  addActual: WRITERS,
  editActual: ADMINS,
  moveActual: ADMINS,
  undoPass: ADMINS,
  manageMonthMoney: ADMINS,
  manageTemplates: ADMINS,
  manageAnnuals: ADMINS,
  manageWorkspace: ADMINS,
  manageMembers: ADMINS,
  leaveWorkspace: ["reader", "editor", "admin"],
  deleteWorkspace: OWNER,
  transferOwnership: OWNER,
  convertToShared: OWNER,
  convertToPrivate: OWNER,
};

export function roleAllows(role: WorkspaceRole, action: WorkspaceAction): boolean {
  return MATRIX[action].includes(role);
}

/**
 * The caller's verified membership. Produced on the server only by
 * `loadWorkspaceAccess()` / `requireWorkspaceAccess()`; every tenant service
 * takes it instead of a bare id (ARCH §5 rule 1a).
 */
export interface WorkspaceAccess {
  readonly userId: string;
  readonly workspaceId: string;
  readonly role: WorkspaceRole;
  readonly kind: WorkspaceKind;
}

/** Same answer as a missing row: a non-member cannot tell the workspace exists (UC-31 §4.8). */
export class WorkspaceNotFoundError extends Error {
  readonly code = "workspace_not_found" as const;
  constructor() {
    super("Workspace not found");
    this.name = "WorkspaceNotFoundError";
  }
}

/** A member whose role does not allow the action (UC-31 §4.8.2). */
export class WorkspaceForbiddenError extends Error {
  readonly code = "workspace_forbidden" as const;
  constructor() {
    super("Your role in this workspace does not allow this action");
    this.name = "WorkspaceForbiddenError";
  }
}

/** Applies the matrix; returns the workspace id to hand to repositories. */
export function authorize(access: WorkspaceAccess, action: WorkspaceAction): string {
  if (!roleAllows(access.role, action)) {
    throw new WorkspaceForbiddenError();
  }
  return access.workspaceId;
}

/** UC-31 §4.14: Admin/Owner edit any ticket; an Editor only the ones they created. */
export function canEditActual(
  access: Pick<WorkspaceAccess, "userId" | "role">,
  createdByUserId: string,
): boolean {
  if (roleAllows(access.role, "editActual")) return true;
  return access.role === "editor" && createdByUserId === access.userId;
}
