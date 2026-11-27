import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as workspaceRepo from "@/server/repositories/workspace";
import {
  addMember,
  createSharedWorkspace,
  deleteWorkspace,
  getWorkspaceDetails,
  leaveWorkspace,
  removeMember,
} from "@/server/services/workspaces";
import {
  PrivateWorkspaceNotTransferableError,
  TransferAlreadyPendingError,
  TransferNoLongerValidError,
  TransferNotFoundError,
  TransferTargetNotAllowedError,
  TransferTargetNotMemberError,
  TransferToSelfError,
  acceptOwnershipTransfer,
  cancelOwnershipTransfer,
  declineOwnershipTransfer,
  getOfferForWorkspace,
  listOffersForUser,
  proposeOwnershipTransfer,
} from "@/server/services/workspace-transfer";
import { loadWorkspaceAccess } from "@/server/auth/workspace-access";
import {
  WorkspaceForbiddenError,
  WorkspaceNotFoundError,
  type WorkspaceAccess,
} from "@/lib/workspace-roles";
import { createCategory } from "@/server/services/categories";
import { createMonth } from "@/server/services/months";
import { addActual } from "@/server/services/actuals";
import { parseAllowlist } from "@/server/auth/allowlist";
import { seedOwnerAccess } from "./_helpers/workspace";

// ============================================================================
// UC-32 workspace ownership transfer — integration (PRD UC-34 / C32,
// §15 scenarios 94–103). Runs on the throwaway `expenses_test` database.
// ============================================================================

const reachable = await pingDatabase();
const suite = reachable ? describe : describe.skip;

const ALLOW = parseAllowlist(
  "owner@example.com, target@example.com, admin@example.com, reader@example.com, other@example.com",
);

interface Fixture {
  owner: WorkspaceAccess;
  target: WorkspaceAccess;
  admin: WorkspaceAccess;
  reader: WorkspaceAccess;
  workspaceId: string;
}

async function seedShared(): Promise<Fixture> {
  const ownerPriv = await seedOwnerAccess("t-owner", { email: "owner@example.com", displayName: "Olga" });
  const targetPriv = await seedOwnerAccess("t-target", { email: "target@example.com", displayName: "Tomás" });
  const adminPriv = await seedOwnerAccess("t-admin", { email: "admin@example.com" });
  const readerPriv = await seedOwnerAccess("t-reader", { email: "reader@example.com" });
  const ws = await createSharedWorkspace(ownerPriv.userId, { name: "Household", currency: "EUR" });
  const owner = await loadWorkspaceAccess(ownerPriv.userId, ws.id);
  await addMember(owner, { email: "target@example.com", role: "editor" }, ALLOW);
  await addMember(owner, { email: "admin@example.com", role: "admin" }, ALLOW);
  await addMember(owner, { email: "reader@example.com", role: "reader" }, ALLOW);
  return {
    owner,
    target: await loadWorkspaceAccess(targetPriv.userId, ws.id),
    admin: await loadWorkspaceAccess(adminPriv.userId, ws.id),
    reader: await loadWorkspaceAccess(readerPriv.userId, ws.id),
    workspaceId: ws.id,
  };
}

async function roleOf(workspaceId: string, userId: string): Promise<string | null> {
  return (await workspaceRepo.findMembership(workspaceId, userId))?.role ?? null;
}

suite("UC-32 ownership transfer", () => {
  beforeAll(async () => {
    await truncateAllTenantTables();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await truncateAllTenantTables();
  });

  afterAll(async () => {
    await db.$client.end({ timeout: 1 });
  });

  // -------------------------------------------------------------------------
  it("94 — the Owner offers ownership to a member; nothing changes until they accept", async () => {
    const f = await seedShared();
    await proposeOwnershipTransfer(f.owner, { toUserId: f.target.userId }, ALLOW);

    expect(await roleOf(f.workspaceId, f.owner.userId)).toBe("owner");
    expect(await roleOf(f.workspaceId, f.target.userId)).toBe("editor");

    const asOwner = await getOfferForWorkspace(f.owner, ALLOW);
    expect(asOwner).toMatchObject({ toUserId: f.target.userId, toLabel: "Tomás", fromUserId: f.owner.userId });
    const incoming = await listOffersForUser(f.target.userId, ALLOW);
    expect(incoming).toEqual([
      expect.objectContaining({ workspaceId: f.workspaceId, workspaceName: "Household", fromLabel: "Olga" }),
    ]);
    // Nobody else sees it as addressed to them.
    expect(await listOffersForUser(f.admin.userId, ALLOW)).toEqual([]);
  });

  // -------------------------------------------------------------------------
  it("95 — accepting leaves exactly one Owner and makes the former Owner an Admin; a failure midway leaves the original Owner", async () => {
    const f = await seedShared();
    await proposeOwnershipTransfer(f.owner, { toUserId: f.target.userId }, ALLOW);

    // Failure between demotion and promotion → rollback.
    const real = workspaceRepo.updateMemberRole;
    let calls = 0;
    const spy = vi.spyOn(workspaceRepo, "updateMemberRole").mockImplementation(async (...args) => {
      calls += 1;
      if (calls === 2) throw new Error("boom: simulated promotion failure");
      return real(...args);
    });
    await expect(acceptOwnershipTransfer(f.target, ALLOW)).rejects.toThrow(/boom/);
    spy.mockRestore();
    expect(await roleOf(f.workspaceId, f.owner.userId)).toBe("owner");
    expect(await roleOf(f.workspaceId, f.target.userId)).toBe("editor");
    expect(await getOfferForWorkspace(f.owner, ALLOW)).not.toBeNull();

    // Real accept.
    await acceptOwnershipTransfer(f.target, ALLOW);
    expect(await roleOf(f.workspaceId, f.target.userId)).toBe("owner");
    expect(await roleOf(f.workspaceId, f.owner.userId)).toBe("admin");
    const [{ owners }] = await db.execute<{ owners: number }>(
      sql`SELECT count(*)::int AS owners FROM workspace_member WHERE workspace_id = ${f.workspaceId} AND role = 'owner'`,
    );
    expect(owners).toBe(1);
    expect(await listOffersForUser(f.target.userId, ALLOW)).toEqual([]);
  });

  // -------------------------------------------------------------------------
  it("96 — declining and cancelling leave roles as they were", async () => {
    const f = await seedShared();
    await proposeOwnershipTransfer(f.owner, { toUserId: f.target.userId }, ALLOW);
    await declineOwnershipTransfer(f.target);
    expect(await getOfferForWorkspace(f.owner, ALLOW)).toBeNull();

    await proposeOwnershipTransfer(f.owner, { toUserId: f.target.userId }, ALLOW);
    await cancelOwnershipTransfer(f.owner);
    expect(await getOfferForWorkspace(f.owner, ALLOW)).toBeNull();

    expect(await roleOf(f.workspaceId, f.owner.userId)).toBe("owner");
    expect(await roleOf(f.workspaceId, f.target.userId)).toBe("editor");

    // Only the recipient can decline or accept; others get not-found.
    await proposeOwnershipTransfer(f.owner, { toUserId: f.target.userId }, ALLOW);
    await expect(declineOwnershipTransfer(f.admin)).rejects.toBeInstanceOf(TransferNotFoundError);
    await expect(acceptOwnershipTransfer(f.admin, ALLOW)).rejects.toBeInstanceOf(TransferNotFoundError);
  });

  // -------------------------------------------------------------------------
  it("97 — only one offer exists per workspace, even with two proposals at once", async () => {
    const f = await seedShared();
    const results = await Promise.allSettled([
      proposeOwnershipTransfer(f.owner, { toUserId: f.target.userId }, ALLOW),
      proposeOwnershipTransfer(f.owner, { toUserId: f.admin.userId }, ALLOW),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(TransferAlreadyPendingError);
    const [{ n }] = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM workspace_transfer WHERE workspace_id = ${f.workspaceId}`,
    );
    expect(n).toBe(1);
    await expect(
      proposeOwnershipTransfer(f.owner, { toUserId: f.reader.userId }, ALLOW),
    ).rejects.toBeInstanceOf(TransferAlreadyPendingError);
  });

  // -------------------------------------------------------------------------
  it("98 — offers to self, to a non-member, to a removed member, or to an address off the allowlist are rejected", async () => {
    const f = await seedShared();
    const outsider = await seedOwnerAccess("t-outsider", { email: "other@example.com" });

    await expect(
      proposeOwnershipTransfer(f.owner, { toUserId: f.owner.userId }, ALLOW),
    ).rejects.toBeInstanceOf(TransferToSelfError);
    await expect(
      proposeOwnershipTransfer(f.owner, { toUserId: outsider.userId }, ALLOW),
    ).rejects.toBeInstanceOf(TransferTargetNotMemberError);

    await removeMember(f.owner, { userId: f.reader.userId });
    await expect(
      proposeOwnershipTransfer(f.owner, { toUserId: f.reader.userId }, ALLOW),
    ).rejects.toBeInstanceOf(TransferTargetNotMemberError);

    const shrunk = parseAllowlist("owner@example.com, admin@example.com");
    await expect(
      proposeOwnershipTransfer(f.owner, { toUserId: f.target.userId }, shrunk),
    ).rejects.toBeInstanceOf(TransferTargetNotAllowedError);
    expect(await getOfferForWorkspace(f.owner, ALLOW)).toBeNull();
  });

  // -------------------------------------------------------------------------
  it("99 — only the Owner can offer or cancel; others follow the UC-31 matrix", async () => {
    const f = await seedShared();
    for (const a of [f.admin, f.target, f.reader]) {
      await expect(
        // The role check comes first, whoever the target is.
        proposeOwnershipTransfer(a, { toUserId: f.owner.userId }, ALLOW),
      ).rejects.toBeInstanceOf(WorkspaceForbiddenError);
    }
    await proposeOwnershipTransfer(f.owner, { toUserId: f.target.userId }, ALLOW);
    await expect(cancelOwnershipTransfer(f.admin)).rejects.toBeInstanceOf(WorkspaceForbiddenError);

    // A non-member never gets an access to try with.
    const outsider = await seedOwnerAccess("t-outsider2", { email: "other@example.com" });
    await expect(loadWorkspaceAccess(outsider.userId, f.workspaceId)).rejects.toBeInstanceOf(
      WorkspaceNotFoundError,
    );
  });

  // -------------------------------------------------------------------------
  it("100 — an offer disappears when its target leaves, is removed, or leaves the allowlist", async () => {
    const f = await seedShared();

    await proposeOwnershipTransfer(f.owner, { toUserId: f.target.userId }, ALLOW);
    await leaveWorkspace(f.target);
    expect(await getOfferForWorkspace(f.owner, ALLOW)).toBeNull();

    await proposeOwnershipTransfer(f.owner, { toUserId: f.admin.userId }, ALLOW);
    await removeMember(f.owner, { userId: f.admin.userId });
    expect(await getOfferForWorkspace(f.owner, ALLOW)).toBeNull();

    await proposeOwnershipTransfer(f.owner, { toUserId: f.reader.userId }, ALLOW);
    const shrunk = parseAllowlist("owner@example.com");
    expect(await listOffersForUser(f.reader.userId, shrunk)).toEqual([]);
    expect(await getOfferForWorkspace(f.owner, shrunk)).toBeNull();
    // Already dropped by the read above; a direct accept is refused either way.
    await expect(acceptOwnershipTransfer(f.reader, shrunk)).rejects.toThrow();
    expect(await roleOf(f.workspaceId, f.owner.userId)).toBe("owner");
  });

  // -------------------------------------------------------------------------
  it("100b — accepting an offer whose target left the allowlist fails as no longer valid and removes it", async () => {
    const f = await seedShared();
    await proposeOwnershipTransfer(f.owner, { toUserId: f.target.userId }, ALLOW);
    await expect(
      acceptOwnershipTransfer(f.target, parseAllowlist("owner@example.com")),
    ).rejects.toBeInstanceOf(TransferNoLongerValidError);
    expect(await getOfferForWorkspace(f.owner, ALLOW)).toBeNull();
    expect(await roleOf(f.workspaceId, f.owner.userId)).toBe("owner");
  });

  // -------------------------------------------------------------------------
  it("101 — after acceptance the former Owner cannot delete or offer the workspace; the new Owner can", async () => {
    const f = await seedShared();
    await proposeOwnershipTransfer(f.owner, { toUserId: f.target.userId }, ALLOW);
    await acceptOwnershipTransfer(f.target, ALLOW);

    const former = await loadWorkspaceAccess(f.owner.userId, f.workspaceId);
    const fresh = await loadWorkspaceAccess(f.target.userId, f.workspaceId);
    expect(former.role).toBe("admin");
    expect(fresh.role).toBe("owner");

    await expect(
      proposeOwnershipTransfer(former, { toUserId: f.reader.userId }, ALLOW),
    ).rejects.toBeInstanceOf(WorkspaceForbiddenError);
    await expect(deleteWorkspace(former, { confirmName: "Household" })).rejects.toBeInstanceOf(
      WorkspaceForbiddenError,
    );

    await proposeOwnershipTransfer(fresh, { toUserId: former.userId }, ALLOW);
    await cancelOwnershipTransfer(fresh);
    // The former Owner, now an Admin, may leave.
    await leaveWorkspace(former);
    await deleteWorkspace(fresh, { confirmName: "household" });
    await expect(loadWorkspaceAccess(f.target.userId, f.workspaceId)).rejects.toBeInstanceOf(
      WorkspaceNotFoundError,
    );
  });

  // -------------------------------------------------------------------------
  it("102 — months, catalogs, tickets and attributions are unchanged by a transfer", async () => {
    const f = await seedShared();
    const food = await createCategory(f.owner, { kind: "expense", name: "Food" });
    const m = await createMonth(f.owner, { year: 2026, month: 11 });
    await addActual(f.owner, { monthId: m.id, categoryId: food.id, name: "Shop", amount: "12.00" });
    await addActual(f.target, { monthId: m.id, categoryId: food.id, name: "Bread", amount: "2.00" });
    const before = await snapshot(f.workspaceId);
    const detailsBefore = await getWorkspaceDetails(f.owner);

    await proposeOwnershipTransfer(f.owner, { toUserId: f.target.userId }, ALLOW);
    await acceptOwnershipTransfer(f.target, ALLOW);

    expect(await snapshot(f.workspaceId)).toEqual(before);
    const detailsAfter = await getWorkspaceDetails(await loadWorkspaceAccess(f.target.userId, f.workspaceId));
    expect(detailsAfter.workspace.currency).toBe(detailsBefore.workspace.currency);
    expect(detailsAfter.authors).toEqual(detailsBefore.authors);
  });

  // -------------------------------------------------------------------------
  it("103 — a private workspace cannot be offered", async () => {
    const owner = await seedOwnerAccess("t-priv", { email: "owner@example.com" });
    await expect(
      proposeOwnershipTransfer(owner, { toUserId: owner.userId }, ALLOW),
    ).rejects.toBeInstanceOf(PrivateWorkspaceNotTransferableError);
  });
});

async function snapshot(workspaceId: string) {
  return db.execute<{ t: string; id: string; created_by: string | null }>(sql`
    SELECT 'category' AS t, id::text AS id, NULL AS created_by FROM category WHERE workspace_id = ${workspaceId}
    UNION ALL SELECT 'month', id::text, NULL FROM month WHERE workspace_id = ${workspaceId}
    UNION ALL SELECT 'actual', a.id::text, a.created_by_user_id::text FROM month_actual_expense a
      JOIN month m ON m.id = a.month_id WHERE m.workspace_id = ${workspaceId}
    ORDER BY 1, 2
  `).then((rows) => rows.map((r) => ({ ...r })));
}

async function pingDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch (err) {
    process.stderr.write(
      `[integration] Postgres unreachable, skipping UC-32 suite: ${(err as Error).message}\n`,
    );
    return false;
  }
}

async function truncateAllTenantTables(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE app_user CASCADE`);
}
