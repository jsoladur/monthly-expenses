# UC-32 — Workspace ownership transfer

> **PRD status:** Product Owner request 2026-11-27. Specified in `docs/prds/GLOBAL.md` as **UC-34** / **C32** (amends §3, §13, §14). This file is the detailed implementation slice.
> **Database:** **adds one table**, `workspace_transfer`, via migration **0009**. Product Owner decision 2026-11-27.
> **PRD refs:** UC-34, C30, C31, C32; §3; §5.1; §13; §14; §15 (scenarios 94–103).
> **ARCH refs:** §3.2 (rules 3–4), §4, §5 (rule 3: transfer is a mutation with its own transaction), ADR-12.
> **Depends on:** **UC-31** (roles, membership, `requireWorkspaceAccess`). Nothing else.

---

## 0. Why this exists

The Owner is the only role that can delete a shared workspace. When the person who set it up stops using it (or hands the household over), the workspace needs a new Owner without deleting anything.

> **The Owner offers the workspace; another member accepts it.** Nobody becomes Owner without saying yes.

---

## 1. Goal

1. The current Owner of a **shared** workspace offers ownership to one current member.
2. The member accepts or declines. Until they accept, nothing changes.
3. On acceptance the member becomes Owner and the previous Owner becomes **Admin**, in one transaction. All data is untouched.

---

## 2. Rules

1. **Shared workspaces only.** A private workspace cannot be offered or transferred (C30).
2. **Only the Owner proposes or cancels** (UC-31 §3 matrix). Admins, Editors and Readers get `workspaceForbidden`. Non-members get `workspaceNotFound`.
3. **Target:** a current member of the workspace with role Reader, Editor or Admin. Not the Owner themself. The target's email must still be in `ALLOWED_EMAILS` when the offer is made **and** when it is accepted.
4. **One offer per workspace.** The table holds at most one row per workspace, so a second offer is rejected with `transferAlreadyPending` until the first is cancelled or declined.
5. **Offer = a row in `workspace_transfer`.** It changes no role and no data. The row is deleted when it is accepted, declined, cancelled, or becomes invalid (rule 8). There is no status column: a row means "pending".
6. **Accept** runs in **one transaction** (ARCH §5):
   1. lock the `workspace` row (`SELECT … FOR UPDATE`);
   2. re-check the offer still exists, the proposer is still the Owner, the target is still a member and still allowlisted; otherwise delete the offer and fail with `transferNoLongerValid`;
   3. set the previous Owner's role to `admin`;
   4. set the target's role to `owner`;
   5. delete the offer row.
   The demotion runs **before** the promotion so the partial unique index "one Owner per workspace" (UC-31 §4.7) is never violated, even for an instant.
7. **Decline** (by the target) and **cancel** (by the Owner) just delete the offer row. Nothing else changes.
8. **Automatic invalidation.** An offer is deleted in the same transaction as: the target leaving (UC-31 §4.5), the target being removed (UC-31 §4.4), or the workspace being deleted (cascade). It is also treated as invalid at accept time if the target is no longer allowlisted.
9. **The former Owner becomes Admin.** They keep their data access, may leave the workspace (UC-31 §4.5 now allows it), and may not delete it or offer it again.
10. **The new Owner** can delete the workspace, offer it again, and do everything else the Owner can do (UC-31 §3).
11. **No data changes.** Months, catalogs, templates, annuals, incomes, lines, actuals and every `created_by_user_id` stay as they are. No active-workspace cookie changes for anyone (the workspace id is the same).
12. **No notifications.** The target finds the offer in the app: on the Workspaces screen and as a badge on their workspace card on Home (UC-31 §7.1). The copy says the offer waits in the app, because no email or push is sent.

---

## 3. Data model (migration 0009)

```
workspace_transfer
  id              uuid pk
  workspace_id    uuid not null  fk workspace.id ON DELETE CASCADE, unique
  from_user_id    uuid not null  fk app_user.id  (the Owner who offered)
  to_user_id      uuid not null  fk app_user.id  (the target)
  created_at      timestamptz not null default now()

  check: from_user_id <> to_user_id
```

- `unique (workspace_id)` — at most one pending offer per workspace (rule 4).
- No status column, no history. Resolved offers are deleted; the audit trail of ownership is not stored in V1 (non-goal, §8).
- Migration 0009 creates the table only. No backfill is needed.

---

## 4. Server-side work

### 4.1 Repository — `src/server/repositories/workspace-transfer.ts`

`workspaceId` first, like every tenant repository (ARCH §5 rule 1):

- `findOfferForWorkspace(workspaceId)`
- `findOfferForRecipient(userId)` — offers addressed to the caller, across all workspaces (for the Home badge and the Workspaces screen)
- `insertOffer(workspaceId, fromUserId, toUserId)` — relies on the unique index for the "already pending" answer (mapped from Postgres `23505`, same walk-the-cause-chain approach as UC-03)
- `deleteOffer(workspaceId)`
- `deleteOffersForUser(workspaceId, userId)` — used by leave / remove (rule 8), inside the caller's transaction

Role changes reuse UC-31's `updateMemberRole`; the accept service does the two updates itself, in order.

### 4.2 Service — `src/server/services/workspace-transfer.ts`

- `proposeOwnershipTransfer(access, toUserId)` — `access` from `requireWorkspaceAccess(workspaceId, 'transferOwnership')` (Owner only). Checks: shared kind; target membership and role; target ≠ owner; target allowlisted (`ALLOWED_EMAILS`); no existing offer. Then `insertOffer`.
- `cancelOwnershipTransfer(access)` — Owner only; deletes the offer.
- `declineOwnershipTransfer(userId, workspaceId)` — recipient only (`to_user_id = userId`); deletes the offer. Non-recipients get `transferNotFound` (no hint that an offer exists).
- `acceptOwnershipTransfer(userId, workspaceId)` — recipient only; the one-transaction flow of §2 rule 6.
- `listOffersForUser(userId)` — read path for Home and the Workspaces screen; drops invalid offers (rule 8) before returning, so the UI never shows a stale offer.

Domain errors: `TransferTargetNotMemberError`, `TransferTargetNotAllowedError`, `TransferToSelfError`, `TransferAlreadyPendingError`, `TransferNotFoundError`, `TransferNoLongerValidError`, `PrivateWorkspaceNotTransferableError`.

### 4.3 Actions

Thin, Zod → `requireUserId()` (plus `requireWorkspaceAccess` where the Owner acts) → service → `revalidatePath('/[locale]', 'layout')`:

- `proposeOwnershipTransferAction`
- `cancelOwnershipTransferAction`
- `acceptOwnershipTransferAction`
- `declineOwnershipTransferAction`

### 4.4 Changes to UC-31 code

- `removeMember` and `leaveWorkspace` call `deleteOffersForUser` in the same transaction.
- `deleteWorkspace` (UC-31) deletes the offer through the cascade; no extra code.
- `workspace_transfer` is added to the children-first delete order in UC-31 §4.6.

---

## 5. Routes and screens

Both screens live on the UC-31 Workspaces details page (`/[locale]/workspaces/[workspaceId]`, shared workspaces only). No new route.

### 5.1 Owner view — "Ownership" section

- Default: "Transfer ownership" button, visible only to the Owner.
- Opens an inline form: a select of current members (Reader / Editor / Admin shown next to each name), then the confirmation.
- Confirmation copy: "After they accept, you become an Admin of this workspace. You can cancel until they accept."
- While an offer is pending: "Offered to {name}. Waiting for their answer." with **Cancel offer**. No second offer can be started.

### 5.2 Recipient view

- A banner on the workspace details page and a badge on the workspace card on Home (UC-31 §7.1): "{owner} offers you ownership of {workspace}."
- **Accept** → inline confirmation: "You become the Owner. {previous owner} becomes an Admin. You can then delete this workspace or offer it on."
- **Decline** → no confirmation; the offer disappears.

### 5.3 Former Owner view

- Immediately after acceptance, the Owner section is replaced by the Admin view (no transfer, no delete). Leave becomes available (UC-31 §4.5).

---

## 6. i18n keys

Under `workspaces.transfer.*` in both locales (parity test applies):

- `workspaces.transfer.title`, `workspaces.transfer.button`, `workspaces.transfer.pick`
- `workspaces.transfer.confirmOffer`, `workspaces.transfer.afterAccept`
- `workspaces.transfer.pending` (ICU, with `{name}`), `workspaces.transfer.cancel`
- `workspaces.transfer.incomingBadge`, `workspaces.transfer.incomingBanner` (with `{owner}`, `{workspace}`)
- `workspaces.transfer.accept`, `workspaces.transfer.acceptConfirm`, `workspaces.transfer.decline`
- `workspaces.transfer.done` ("You are now the Owner of {workspace}.")
- Errors under `validation.transfer*`: `transferTargetNotMember`, `transferTargetNotAllowed`, `transferToSelf`, `transferAlreadyPending`, `transferNotFound`, `transferNoLongerValid`, `privateWorkspaceNotTransferable`.

Copy: active voice, no apology. "Waiting for their answer" rather than "pending approval".

---

## 7. Acceptance criteria

- The Owner can offer ownership to a member; nothing changes until that member accepts (scenario 94).
- Acceptance leaves exactly one Owner and makes the former Owner an Admin, in one transaction; a failure midway leaves the original Owner in place (scenario 95).
- Decline and cancel leave roles and data as they were (scenario 96).
- Only one offer exists per workspace (scenario 97).
- Offers to self, to a non-member, to a removed member, or to an address no longer allowlisted are rejected (scenario 98).
- Only the Owner can offer or cancel; the answer for others follows the UC-31 matrix (scenario 99).
- An offer disappears when its target leaves, is removed, or is no longer allowlisted (scenario 100).
- After acceptance the former Owner cannot delete or offer the workspace; the new Owner can (scenario 101).
- Months, catalogs, tickets and attributions are unchanged by a transfer (scenario 102).
- Private workspaces cannot be offered (scenario 103).

---

## 8. Tests (PRD §15 scenarios 94–103)

- `tests/integration/workspace-transfer.test.ts` — 94–103, including the rollback case (simulate a failure between the demotion and the promotion; assert the original Owner is still Owner and the offer still exists).
- `tests/integration/workspace-transfer.test.ts` — concurrency: two proposals at once → exactly one row.
- `tests/unit/workspace-transfer-rules.test.ts` — pure validity check used by list and accept (membership, allowlist, shared kind).
- `tests/e2e/workspace-transfer.spec.ts` — Owner offers → recipient sees banner and badge → accepts → old Owner sees Admin view; Spanish variant; mobile-safari project.

---

## 9. Decisions taken while drafting (PO to confirm)

1. **Acceptance is required.** The request says "transfer"; a one-step transfer would let an Owner push ownership (and the delete power) onto someone who has not agreed. Easy to change to a one-step transfer if preferred.
2. **The former Owner becomes Admin**, not Editor or Reader.
3. **Any member may be the target** (Reader, Editor or Admin), not only Admins.
4. **No offer history** is stored in V1.

---

## 10. Non-goals

- Transfer between workspaces, or of a private workspace.
- Multiple simultaneous offers.
- Notifications by email, push, or Google.
- Owner succession rules (for example, automatic transfer when the Owner leaves the allowlist). If the Owner's email is removed from `ALLOWED_EMAILS`, the workspace stays as it is and the Owner stays Owner. The Owner can still be locked out of the app; this is an allowlist decision, not a transfer rule.
- Audit trail of ownership changes.

---

## 11. Depends on / unlocks

- Depends on: UC-31.
- Unlocks: nothing in the current build order.
- Schema: **migration 0009** (PO decision 2026-11-27).
