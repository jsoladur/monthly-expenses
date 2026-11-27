# UC-33 — Convert the private workspace into a shared one (and back)

> **PRD status:** Product Owner request 2026-11-27. Specified in `docs/prds/GLOBAL.md` as **UC-35** / **C33**. This file is the detailed implementation slice.
> **Database:** **no schema change.** Both operations re-label existing `workspace` rows and adjust `workspace_member` (and `workspace_invitation` / `workspace_transfer`) inside one transaction. No tenant row is copied or re-pointed.
> **PRD refs:** UC-35, C30, C31, C32, C33, §5.1, §6.9–6.11, §10 (screen 14), §15 (scenarios 104–113).
> **ARCH refs:** §3.2 rule 6, §4 (workspace invariants), §5 rules 1–3, ADR-12.
> **Depends on:** UC-31 (workspaces, roles, invitations). Interacts with UC-32 (see §4.5).

---

## 0. Why this exists

A user who has kept their household ledger in their **private workspace** for months wants to share exactly that ledger — months, categories, fixed expenses, annuals, history — with other people who already use the app. Today they could only create an empty shared workspace and start again.

The reverse also happens: someone shares a ledger, then realises they should not have, and wants it back as their private ledger.

> **Convert = change what a workspace *is*, not where its rows live.** The rows keep their `workspace_id`; the workspace row changes from `private` to `shared` (or back), and the user gets a fresh empty private workspace (or loses the old one).

---

## 1. Goal

1. **Share my private workspace.** The Owner of a private workspace turns it into a shared workspace with a name. All its data comes along, untouched. The user immediately gets a new, **empty** private workspace, exactly as if it had just been created at sign-in.
2. **Make a shared workspace my private workspace.** The Owner of any shared workspace turns it back into their private workspace. Their **current** private workspace and **all its data are permanently deleted** and replaced by the shared workspace's data. Every other member loses access.
3. Both operations are behind strong, explicit confirmations: **two steps** to share, **three steps** to make private.

---

## 2. Rules

### 2.1 Who may do it (extends the UC-31 §3 matrix)

| Capability | Reader | Editor | Admin | Owner |
| --- | :-: | :-: | :-: | :-: |
| Share my private workspace (convert private → shared) | | | | ✔ (private workspace only; its Owner is always its user) |
| Make this shared workspace my private workspace (convert shared → private) | | | | ✔ |

- New matrix actions: `convertToShared` (Owner, private kind only) and `convertToPrivate` (Owner, shared kind only).
- Admin, Editor and Reader get `workspaceForbidden`. A non-member gets the usual not-found answer (UC-31 §4.8).
- `convertToShared` on a shared workspace, or `convertToPrivate` on a private workspace → `workspaceForbidden` (`PrivateWorkspaceImmutableError` / new `WorkspaceAlreadySharedError` at service level, both mapped to the same key).

### 2.2 Share my private workspace (private → shared)

Input: a **name** (trimmed, 1–60 characters, same rules as UC-31 §4.2) and the two confirmations (§3.1).

One transaction (`SELECT … FOR UPDATE` on the workspace row first):

1. Check: caller is the Owner, workspace `kind = 'private'`, `personal_user_id = caller`.
2. `UPDATE workspace SET kind = 'shared', name = :name, personal_user_id = NULL` on that row. Its `id`, `currency`, every catalog row, month, income, reserved line and actual stay as they are. The caller's `workspace_member` row stays `owner`.
3. Insert a **new private workspace** for the caller (`kind = 'private'`, `personal_user_id = caller`, `currency = profile_settings.currency`, default `EUR`) with an `owner` membership — the same rows `ensurePrivateWorkspace` creates at sign-in. It has no categories, templates, annuals or months.
4. Order matters for the database invariants: step 2 frees `workspace_personal_user_uk` before step 3 claims it; `workspace_private_user_ck` and `workspace_shared_name_ck` hold after each statement.

After it:

- The active workspace stays on the converted workspace (same id), so the user sees the same data, now with the workspace switcher (they have two workspaces). The `last_opened_month` cookie is kept (the months did not change workspace).
- The user can add members from the details screen as usual (UC-31 §4.3).
- `created_by_user_id` on every actual stays the user's, so "Added by" shows the user once others join.

### 2.3 Make this shared workspace my private workspace (shared → private)

Input: the three confirmations (§3.2).

One transaction (`SELECT … FOR UPDATE` on both workspace rows, private first, then shared — fixed order to avoid deadlocks):

1. Check: caller is the Owner, workspace `kind = 'shared'`.
2. Delete the caller's **current private workspace** and everything in it, children first (the UC-31 `deleteWorkspaceCascade` order: actuals, reserved lines, incomes, months, templates, annuals, categories, invitations, members, workspace). If it holds no data, only the workspace and membership rows go.
3. Delete every `workspace_member` row of the shared workspace **except the caller's**, every `workspace_invitation` of it, and its `workspace_transfer` offer if UC-32 is in place (§4.5).
4. `UPDATE workspace SET kind = 'private', personal_user_id = :caller, name = NULL` on the shared row. Its `id`, `currency` and every data row stay as they are.
5. Mirror the currency into `profile_settings.currency` (UC-31 §4.2.4: the private workspace's currency and the profile currency stay equal).

After it:

- The workspace is the caller's private workspace (same id). The active-workspace cookie keeps pointing at it. `last_opened_month` is cleared.
- Former members lose access on their next request; their `active_workspace` cookie falls back to their own private workspace (UC-31 §4.9). Their private workspaces are untouched.
- Actuals that former members added keep their `created_by_user_id`; "Added by" is not shown in a private workspace (UC-31 §4.12), so nothing names them.
- If the caller now has only one workspace, the app returns to single-workspace mode (no switcher).
- Any shared workspace the caller owns can be made private, not only one that started as their private workspace (PO request).

### 2.4 Atomicity and failure

- Each operation is one transaction. A failure at any statement leaves both workspaces exactly as before (scenario 113).
- Re-submitting after success fails safely: the second share finds a shared workspace (`workspaceForbidden`); the second make-private finds a private one (`workspaceForbidden`).

---

## 3. Confirmations (normative)

The server is the gate: the action receives the typed text and re-checks it. The UI steps are a bottom-sheet flow (`Drawer`, AGENTS.md §2 pattern), one step per screen, with **Back** and **Cancel** on every step. Cancelling at any step changes nothing.

### 3.1 Share — two confirmations

1. **Explain.** What happens: "All months, categories, fixed expenses and annuals of your private workspace move to a new shared workspace. You get a new, empty private workspace." Shows the counts (months, categories, templates, annuals, actuals). Name field (required). **Continue** is enabled only with a valid name.
2. **Confirm.** "Type **{name}** to confirm." The **Share** button is enabled only when the typed text matches the name (trimmed, inner spaces collapsed, case-insensitive — same matcher as UC-31 delete).

Server inputs: `{ workspaceId, name, confirmName }`; rejects with `workspaceNameMismatch` when `confirmName` does not match `name`.

### 3.2 Make private — three confirmations

1. **What you lose.** "Your current private workspace will be **permanently deleted** and replaced by **{shared name}**." Lists the counts of the current private workspace (months, categories, templates, annuals, actuals). If it has data, offers **Export my private workspace first** (UC-19 export, opens in place; optional). If it has none, says so. **Continue**.
2. **Who loses access.** Lists the other members (name or email, role) and pending invitations that will be removed: "They will no longer see this workspace. Their own private workspaces are not affected." If there are none, says so. A checkbox "I understand my current private data will be deleted and cannot be recovered" must be ticked to **Continue**.
3. **Confirm.** "Type **{shared name}** to confirm." The destructive **Make private** button is enabled only when it matches.

Server inputs: `{ workspaceId, confirmName, acknowledgeDataLoss: true }`; rejects with `workspaceNameMismatch` or `validation` when either is missing.

---

## 4. Server-side work

### 4.1 Matrix — `src/lib/workspace-roles.ts`

Add `convertToShared` and `convertToPrivate` (Owner only) to `WORKSPACE_ACTIONS`; the unit matrix test gains both rows.

### 4.2 Repository — `src/server/repositories/workspace.ts` (`workspaceId` first)

- `lockWorkspace(workspaceId, tx)` — `SELECT … FOR UPDATE`.
- `markShared(workspaceId, name, tx)` / `markPrivate(workspaceId, userId, tx)` — the two `UPDATE`s of §2.2 step 2 and §2.3 step 4.
- `deleteOtherMembers(workspaceId, keepUserId, tx)`, `deleteInvitationsOf(workspaceId, tx)`.
- Reuse `insertPrivateWorkspace`, `deleteWorkspaceCascade` (extend it to accept a private workspace when called from this service only; the public delete path keeps its shared-only guard).

### 4.3 Service — `src/server/services/workspace-conversion.ts`

- `getShareSummary(access)` / `getMakePrivateSummary(access)` — the counts and the member/invitation lists for the confirmation steps.
- `shareMyPrivateWorkspace(access, { name, confirmName })`.
- `makeWorkspaceMyPrivate(access, { confirmName, acknowledgeDataLoss })`.
- Errors: reuse `WorkspaceForbiddenError`, `WorkspaceNameMismatchError`, `InvalidWorkspaceNameError`; add `WorkspaceAlreadySharedError`.

### 4.4 Actions — `src/actions/workspaces.ts`

Thin, Zod → `requireWorkspaceAccess(workspaceId)` → service → `revalidatePath('/[locale]', 'layout')`:

- `shareMyPrivateWorkspaceAction` → returns `{ ok: true, workspaceId }`; the client goes to the workspace details screen (to add members).
- `makeWorkspaceMyPrivateAction` → clears `last_opened_month`, sets `active_workspace` to the workspace, redirects to Home.

### 4.5 UC-32 interplay

- Make-private deletes the workspace's `workspace_transfer` row in the same transaction. If UC-33 is implemented **before** UC-32, UC-32 adds that delete to `makeWorkspaceMyPrivate` (UC-32 §4.4 lists it).
- Converting does not change who the Owner is, so no offer becomes invalid by sharing.
- A user who received ownership through UC-32 is that workspace's Owner and may make it private.

---

## 5. Routes and screens

- **Workspaces screen (`/[locale]/workspaces`)** — the private workspace row gets a **Share this workspace** action (it opens the §3.1 flow). Available in single- and multi-workspace mode (Workspaces is its own section, UC-31 §4.11).
- **Workspace details (`/[locale]/workspaces/[workspaceId]`, Owner)** — a danger-zone item **Make this my private workspace** next to Delete (opens the §3.2 flow). Not shown to Admin, Editor or Reader.
- After share: workspace details of the (now shared) workspace, with a one-time notice "Your private workspace is now shared. You have a new, empty private workspace."
- After make-private: Home, with a one-time notice "{name} is now your private workspace."

---

## 6. i18n keys

Namespace `workspaces.convert` (both locales, parity test applies):

- `share.action`, `share.title`, `share.explain`, `share.counts.*` (ICU plurals: months, categories, templates, annuals, actuals), `share.nameLabel`, `share.continue`, `share.typePrompt`, `share.confirm`, `share.pending`, `share.done`
- `private.action`, `private.title`, `private.step1.*` (lead, counts, empty, export), `private.step2.*` (lead, membersList, invitationsList, none, acknowledge), `private.step3.*` (typePrompt, confirm, pending), `private.done`
- `back`, `cancel`, `error`
- `validation.workspaceAlreadyShared` (falls back to `workspaceForbidden` copy if the PO prefers one message)

Copy rules: plain verbs, sentence case, the irreversible part in bold, no "Are you sure?".

---

## 7. Acceptance criteria

- Sharing keeps every row, id and count of the former private workspace, now as a shared workspace owned by the user; the user has a new empty private workspace (scenarios 104, 106).
- Only the Owner can share their private workspace or make a shared workspace private; everyone else is refused by the server (scenarios 105, 109).
- Both flows refuse without their confirmations, server side (scenarios 107, 110).
- Making private replaces the current private workspace and its data, removes every other member and invitation, and keeps the shared data and ids (scenarios 108, 111).
- Share then make-private returns the original data to the private workspace with the same ids (scenario 112).
- A failure midway changes nothing (scenario 113).
- No schema change; `database.dbml` unchanged except notes.

---

## 8. Tests (PRD §15 scenarios 104–113)

Map to `tests/unit/workspace-access.test.ts` (two new matrix rows), `tests/integration/workspace-conversion.test.ts` (104–113), `tests/e2e/workspace-conversion.spec.ts` (104 and 108 through the UI, confirmation steps, Spanish variant).

104. Sharing the private workspace turns it into a shared workspace with the given name, owned by the user, with the same id and every row unchanged; the user then has a new, empty private workspace whose currency comes from their profile.
105. Only the private workspace's Owner can share it; sharing a shared workspace or another user's private workspace is refused (forbidden / not found).
106. After sharing, the user can add members to it; other users' private workspaces are untouched; the active workspace stays on the shared one.
107. Sharing without a matching typed name is refused and changes nothing; cancelling the flow at any step changes nothing.
108. Making a shared workspace private deletes the Owner's current private workspace and all its data, removes every other member, invitation and pending ownership offer, and keeps the shared workspace's id and rows as the new private workspace.
109. Making private is refused for Admin, Editor and Reader (forbidden), for non-members (not found), and for a workspace that is already private.
110. Making private without the typed name or without acknowledging the data loss is refused and changes nothing.
111. After making private, former members lose access on their next request, their active-workspace cookie falls back to their own private workspace, their tickets stay attributed to them, and "Added by" is not shown.
112. Share, then make the same workspace private again: the private workspace holds the original data with the same ids, and the empty private workspace created by sharing is gone.
113. A failure in the middle of either operation leaves both workspaces and all memberships as before.

---

## 9. Decisions taken while drafting (PO to confirm)

1. **Convert by re-labelling, not by copying.** Data keeps its `workspace_id`; the workspace row changes kind. Atomic, instant, and ids never change (bookmarks, exports, `converted_from_line_id` links stay valid).
2. **Making private removes every other member** (and invitations, and a pending ownership offer). A private workspace has only its user (UC-31 §4.7).
3. **Any shared workspace the user owns can become private**, not only one that started as theirs (as requested).
4. **Former members' tickets keep `created_by_user_id`.** Nothing is rewritten; "Added by" is hidden in private workspaces anyway.
5. **Currency follows the workspace.** Sharing keeps the currency on the shared workspace; the new private workspace takes `profile_settings.currency`. Making private keeps the workspace's currency and mirrors it into `profile_settings`.
6. **Two confirmations to share** (explain + name, then typed name) and **three to make private** (what you lose, who loses access + acknowledgement, typed name). The triple confirmation is required even when the current private workspace is empty (it says so in step 1).
7. **An optional "Export my private workspace first"** link (UC-19) in make-private step 1. No automatic backup is kept.
8. **No undo window and no trash.** The confirmations are the safeguard; deleted private data is gone.
9. **No notification** to members who lose access (consistent with UC-31 §12).

---

## 10. Non-goals

- Merging two workspaces, or moving only part of the data (some months or categories) between workspaces.
- Keeping the old private data somewhere recoverable after make-private.
- Converting someone else's private workspace, or letting an Admin convert.
- Notifications or emails about the conversion.

---

## 11. Depends on / unlocks

- Depends on: UC-31. Interacts with UC-32 (§4.5); either order works.
- Unlocks: nothing.
- Schema: **none** (PO request 2026-11-27).
