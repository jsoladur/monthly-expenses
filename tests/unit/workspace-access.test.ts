import { describe, expect, it } from "vitest";
import {
  ASSIGNABLE_ROLES,
  WORKSPACE_ACTIONS,
  WorkspaceForbiddenError,
  authorize,
  canEditActual,
  roleAllows,
  type WorkspaceAction,
  type WorkspaceRole,
} from "@/lib/workspace-roles";

// ============================================================================
// UC-31 §3 — the role matrix as a pure table (PRD C31).
//
// Each row is one capability of the normative matrix. ✔ = allowed.
// `editActual` is the "any ticket" right; the Editor own-only rule is
// `canEditActual` (UC-31 §4.14).
// ============================================================================

const R = "reader" as const;
const E = "editor" as const;
const A = "admin" as const;
const O = "owner" as const;

const MATRIX: Record<WorkspaceAction, readonly WorkspaceRole[]> = {
  read: [R, E, A, O],
  createMonth: [E, A, O],
  deleteMonth: [A, O],
  createCategory: [E, A, O],
  manageCategories: [A, O],
  addActual: [E, A, O],
  editActual: [A, O],
  moveActual: [A, O],
  undoPass: [A, O],
  manageMonthMoney: [A, O],
  manageTemplates: [A, O],
  manageAnnuals: [A, O],
  manageWorkspace: [A, O],
  manageMembers: [A, O],
  leaveWorkspace: [R, E, A],
  deleteWorkspace: [O],
  transferOwnership: [O],
  convertToShared: [O],
  convertToPrivate: [O],
};

const ROLES: WorkspaceRole[] = [R, E, A, O];

describe("UC-31 §3 role matrix", () => {
  it("covers every action exactly once", () => {
    expect([...WORKSPACE_ACTIONS].sort()).toEqual(Object.keys(MATRIX).sort());
  });

  for (const [action, allowed] of Object.entries(MATRIX) as [WorkspaceAction, WorkspaceRole[]][]) {
    for (const role of ROLES) {
      const expected = allowed.includes(role);
      it(`${role} ${expected ? "may" : "may not"} ${action}`, () => {
        expect(roleAllows(role, action)).toBe(expected);
      });
    }
  }

  it("never offers Owner as an assignable role (ownership moves only by transfer)", () => {
    expect(ASSIGNABLE_ROLES).toEqual(["reader", "editor", "admin"]);
  });
});

describe("authorize()", () => {
  const access = { userId: "u1", workspaceId: "w1", role: E, kind: "shared" as const };

  it("returns the workspace id when the role allows the action", () => {
    expect(authorize(access, "addActual")).toBe("w1");
  });

  it("throws WorkspaceForbiddenError when the role does not", () => {
    expect(() => authorize(access, "deleteMonth")).toThrow(WorkspaceForbiddenError);
  });
});

describe("UC-31 §4.14 editing rule for actual expenses", () => {
  it("lets an Editor edit only the tickets they created", () => {
    expect(canEditActual({ userId: "u1", role: E }, "u1")).toBe(true);
    expect(canEditActual({ userId: "u1", role: E }, "u2")).toBe(false);
  });

  it("lets Admin and Owner edit any ticket", () => {
    expect(canEditActual({ userId: "u1", role: A }, "u2")).toBe(true);
    expect(canEditActual({ userId: "u1", role: O }, "u2")).toBe(true);
  });

  it("never lets a Reader edit, not even a ticket attributed to them", () => {
    expect(canEditActual({ userId: "u1", role: R }, "u1")).toBe(false);
  });
});
