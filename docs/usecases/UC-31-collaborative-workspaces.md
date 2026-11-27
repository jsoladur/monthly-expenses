# UC-31 — Collaborative workspaces (private by default, shared with roles)

> **PRD status:** Product Owner decision 2026-11-27. Specified in `docs/prds/GLOBAL.md` as **UC-33** / **C30**, **C31** (amends C1, C9, C10, §3, §5.1, §5.3, §6, §13, §14). This file is the detailed implementation slice.
> **Database:** **the tenancy change.** Migration **0008** adds `workspace`, `workspace_member`, `category.workspace_id`, `template.workspace_id`, `annual.workspace_id`, `month.workspace_id`, `month_actual_expense.created_by_user_id`, backfills every existing user into a private workspace, and drops the old `user_id` columns of the four catalog/month tables. Full rules in §4.
> **PRD refs:** UC-33, C1, C9, C10, C30, C31, §3, §5.1–5.4, §6.2–6.4, §6.8, §10 (screens 3, 5–8, 11–13), §13, §14, §15 (scenarios 78–93).
> **ARCH refs:** §3.2 (rules 3–4), §4, §5 (rules 1–3), ADR-12 (new: workspace-scoped tenancy).
> **Next slice:** UC-32 (ownership transfer) builds on this one and adds migration 0009.

---

## 0. Why this exists

Two people who share a household want one ledger for the common bills, while each keeps their own private ledger. Today every row belongs to exactly one user, so there is no way to share.

> **Make the workspace the tenant, not the user.** Every user keeps a private workspace that behaves exactly like today. Users may also create shared workspaces and invite other allowlisted users with a role.

---

## 1. Goal

1. Every allowlisted user has **one private workspace**, created at first sign-in (and backfilled for existing users). It cannot be deleted, shared, or transferred.
2. Any allowlisted user can create a **shared workspace** and becomes its **Owner**.
3. The Owner (and Admins) add other **allowlisted users who have signed in at least once** with a role: **Reader**, **Editor** (Read/Write), or **Admin**.
4. A workspace has its own categories, fixed/estimated templates, annuals, months, incomes, reserved lines, actuals, currency and every report that exists today. Nothing is shared across workspaces.
5. A user with only one workspace sees **exactly the current app**. No workspace wording appears anywhere.
6. A user with several workspaces picks one; every section then shows that workspace.

---

## 2. Scope

**In**

- Workspace model, private-workspace provisioning, migration 0008 with backfill.
- Roles and the permission matrix (§3).
- Create shared workspace; rename and currency (Admin+).
- Member management: add, change role, remove (Admin+); leave (any non-owner).
- Delete shared workspace (Owner only, typed name).
- Active-workspace cookie, switcher, Home workspace list, Workspaces screen.
- Scoping of every existing screen, server action and report to the active workspace.
- `created_by_user_id` on actual expenses, with "Added by" shown only in shared workspaces.

**Out (see §11 for the non-goals list)**

- Ownership transfer — UC-32.
- Invitations to people who have never signed in (pending invites).
- Email or push notifications.
- Per-category or per-month permissions, custom roles, audit-log screen.
- Moving rows between workspaces, copying a workspace, merging workspaces.

---

## 3. Roles and permission matrix (normative)

Roles are per workspace. The matrix is enforced **on the server** in the service layer (§5). The UI only hides or disables what the matrix forbids.

| Capability | Reader | Editor (Read/Write) | Admin | Owner |
| --- | :-: | :-: | :-: | :-: |
| See every screen and report of the workspace (Home, months, History, Categories, Fixed, Annuals, Stats, Search, Export, Settings) | ✔ | ✔ | ✔ | ✔ |
| Create a month | | ✔ | ✔ | ✔ |
| Delete a month (UC-27) | | | ✔ | ✔ |
| Create an expense category | | ✔ | ✔ | ✔ |
| Rename, deactivate, reactivate, or change the savings flag of a category | | | ✔ | ✔ |
| Add an actual expense | | ✔ | ✔ | ✔ |
| Edit or hard-delete an actual expense | | own only | ✔ | ✔ |
| Move an actual to another month (UC-26), undo a pass (UC-10) | | | ✔ | ✔ |
| Incomes, reserved lines (add, edit remaining, delete, pass to actual), estimate check, pass to upcoming month | | | ✔ | ✔ |
| Templates (fixed/estimated catalog): create, edit, schedule, end month, deactivate, delete | | | ✔ | ✔ |
| Annuals: create, edit, deactivate | | | ✔ | ✔ |
| Rename workspace, change workspace currency | | | ✔ | ✔ |
| Add members, change a member's role (Reader / Editor / Admin), remove members | | | ✔ | ✔ |
| Leave the workspace | ✔ | ✔ | ✔ | not allowed (transfer ownership or delete first) |
| Delete the workspace | | | | ✔ |
| Propose or cancel an ownership transfer (UC-32) | | | | ✔ |

Member rules that come with the matrix:

- Admins may manage every member **except the Owner**. Nobody can set the Owner role through this screen; the Owner role moves only by ownership transfer (UC-32).
- A Reader or Editor never sees a control they cannot use. The server still rejects the call with the keyed `workspaceForbidden` error.
- The private workspace has exactly one member, its user, as Owner. It has no member controls at all.

---

## 4. Rules

### 4.1 Private workspace

1. Created in the same transaction as `app_user` + `profile_settings` on first sign-in (UC-01), with `kind = 'private'`, `personal_user_id = app_user.id`, `currency` copied from `profile_settings.currency` (default `EUR`), and one `workspace_member` row with role `owner`.
2. Exactly one per user (`personal_user_id` unique). Never deleted, never shared, never transferred. Its name is not user-editable; the UI shows the localized label "My private workspace" / "Mi espacio privado".
3. Backfill: migration 0008 creates it for **every existing `app_user`** before any tenant row is re-pointed (§6).

### 4.2 Shared workspace

1. Any allowlisted user may create one. The creator becomes its Owner. No cap on the number of shared workspaces in V1.
2. Name: trimmed, 1–60 characters, not required to be unique. Currency: chosen at creation, pre-selected from `profile_settings.currency` (inherited from it when none is given), editable by Admin+ later (label only, no FX — C9).
4. **The currency belongs to the workspace** (`workspace.currency`), not to any user (PO decision 2026-11-27). It is copied from the creator's `profile_settings.currency` only once, at creation. Afterwards no user's profile currency affects it, and handing the workspace to another Owner (UC-32) leaves it unchanged. Changing a shared workspace's currency never writes any `profile_settings`. For a **private** workspace, `profile_settings.currency` mirrors the workspace currency: changing one in Settings updates the other, so new shared workspaces inherit the currency the user works with privately.
3. Starts empty: no categories, templates, annuals or months are copied from any other workspace. The Owner builds it the same way a new user builds their private one.

### 4.3 Adding members

1. Input: an email address. Normalized (trim, lowercase) exactly like the allowlist (ARCH §3.2 rule 1).
2. Rejected, in this order:
   - Not in `ALLOWED_EMAILS` at the time of the action → `workspaceEmailNotAllowed`. The allowlist remains the only gate; nothing is stored for the address.
   - Allowlisted but no `app_user` row yet (never signed in) → `workspaceMemberNeverSignedIn`. The copy asks the person to sign in once first. No pending invitation is created.
   - Already a member → `workspaceMemberExists`.
3. Role on add: Reader, Editor or Admin. Never Owner.
4. Adding a member never copies or changes data. The new member sees the workspace on their next request.

### 4.4 Changing roles and removing members

1. Admin+ may change a non-owner member between Reader, Editor and Admin, and remove a non-owner member.
2. The Owner cannot be changed, removed or demoted here. A last-owner invariant is enforced by the database (§4.7).
3. Removal deletes only the `workspace_member` row. The member's created actuals stay in the workspace with their `created_by_user_id`; the UI shows the person's display name, or their email when no name is stored. Access ends on the next request.

### 4.5 Leaving

1. Any non-owner member may leave. Leaving is removing one's own membership; it follows §4.4 for data.
2. The Owner cannot leave. The button says "Transfer ownership or delete this workspace first" and links to the workspace details screen (ownership transfer is UC-32; deletion is §4.6).

### 4.6 Deleting a shared workspace

1. Owner only. Private workspaces cannot be deleted.
2. Behind a confirmation that lists the number of months, categories, templates, annuals and members that will go, and enables **Delete** only when the user types the workspace name exactly as shown (trimmed, case-insensitive) — the same pattern as C27.
3. One transaction, children first: actual expenses, reserved lines and incomes (via months), months, templates, annuals, categories, members. Nothing outside the workspace is touched.
4. After deletion, every member's active-workspace cookie that points to it falls back to the private workspace on the next request (§4.9).

### 4.7 Database invariants

- `workspace_member(workspace_id, user_id)` unique.
- Partial unique index on `workspace_member(workspace_id) WHERE role = 'owner'` — exactly one Owner per workspace.
- `workspace.personal_user_id` unique where not null; `check: (kind = 'private') = (personal_user_id IS NOT NULL)`; `check: kind = 'private' OR name IS NOT NULL`.
- Every tenant table has `workspace_id NOT NULL`, FK to `workspace(id)` **ON DELETE CASCADE**.
- The `workspace_member` row of a private workspace always has role `owner` (service-enforced; no database check in V1).

### 4.8 Access control and the "not a member" answer

1. A workspace the user does not belong to is **not found**: any route, action or query that receives a `workspace_id` the caller is not a member of returns the same not-found answer as a missing row. No existence leak (PRD §5.1, test scenario 2).
2. A member who lacks the role for an action gets `workspaceForbidden`. This is only shown to members, so it reveals nothing new.

### 4.9 Active workspace

1. Stored in the `active_workspace` cookie (workspace id). Not in the URL, so every existing route and bookmark keeps working.
2. Missing cookie, malformed value, or a workspace the user no longer belongs to → the **private workspace** is used, and the cookie is rewritten on the next switch.
3. Switching is a server action `setActiveWorkspaceAction` (Zod → `requireUserId()` → membership check → cookie). It also **clears** the `last_opened_month` cookie (§4.10) and revalidates the layout.
4. The cookie is a UX convenience, not a security boundary (PRD §5.4). Every read and write re-checks membership.

### 4.10 Last opened month

- The cookie format `YYYY-M` does not change.
- Home resumes it only if that month exists **in the active workspace**. Switching workspace clears it (§4.9.3), so the same period in another workspace is never opened by accident.

### 4.11 Single-workspace mode (the "invisible" rule)

When the user is a member of **exactly one** workspace (their private one), the app is the current version:

- Home shows the same month list, empty state and create form as today.
- No Home workspace list, no workspace chip or switcher in the header, no role badge, no "shared", "Added by" or workspace name text in any screen or form.
- No workspace field in any form. Forms never gain a workspace picker in any mode; the active workspace is always implicit.
- The Settings currency control keeps its current label and position.
- **One exception, so a first shared workspace can be created:** Settings shows a single "Share with others" row that opens the create-shared form. It is the only workspace entry point in single-workspace mode, and it never lists or names a workspace.

### 4.12 Multi-workspace mode

- **Home** shows, first, a list of the user's workspaces (§7.1). Selecting one makes it active and reloads Home with that workspace's months. The active workspace is always highlighted; there is no "no workspace" state.
- **Header:** the active workspace name appears as a quiet control that opens the Home workspace list. It is the only workspace-level indicator on screens.
- Every section (Home, History, Categories, Fixed, Annuals, Stats, Search, Export, Settings, month workspaces) shows only the active workspace's data.
- Shared-workspace rows show "Added by {name}" on actual expenses. Private workspaces never show it.

### 4.13 Data rules that stay as they are

Every money rule of the PRD (§7) and every UC except the tenancy plumbing is unchanged. In particular: months are still never auto-created (C6), templates are still a clone source only (C17), and overspend, summary, Stats, Search, Export, annual reminders and the estimate check all compute from the **active workspace only**.

Name autocomplete (UC-17, UC-30) reads the **active workspace**, so members of a shared workspace see each other's recent names. That is intended and stays inside the membership boundary (test scenario 27 still holds for private workspaces and for non-members).

### 4.14 Editing rule for actual expenses

- Editor: may edit or hard-delete an actual **only if `created_by_user_id` is that user**. Other members' tickets are read-only for Editors.
- Admin and Owner: may edit or hard-delete any actual in the workspace.
- Editing a pass-to-actual ticket still sets `edited_after_conversion` (PRD §7.5). The `created_by_user_id` of a pass-to-actual ticket is the user who passed the line.
- A Reader sees no edit, delete, move or undo controls on tickets.

---

## 5. Server-side work

### 5.1 Migration 0008 (forward-only)

See §6 for the exact order. Also: `profile_settings.currency` stays (it is the default for new shared workspaces and the source for the private workspace at creation). `profile_settings.theme` stays and remains per user.

### 5.2 Repositories

- **Every tenant repository function takes `workspaceId` as its first argument** and applies it in every `WHERE` (ARCH §4 / ADR-12). This replaces the `userId`-first rule for tenant data. Identity repositories (`user.ts`, `profile-settings.ts`) keep `userId`.
- `category`, `template`, `annual`, `month`: filter `workspace_id`. `month_income`, `month_fixed_line`, `month_actual_expense`: join `month` and filter `month.workspace_id` (same pattern as today's `month.user_id`).
- New `src/server/repositories/workspace.ts`: `findPrivateWorkspaceByUser`, `insertPrivateWorkspace`, `listWorkspacesForUser`, `findMembership(workspaceId, userId)`, `insertWorkspace`, `updateWorkspace`, `deleteWorkspaceCascade` (children first, one statement per table, inside the caller's transaction), `insertMember`, `updateMemberRole`, `deleteMember`, `countOwners`.
- `actual.ts`: `insertActual` sets `created_by_user_id`; `updateActual` / `deleteActual` take the acting user for the Editor own-only check.
- `profile-settings.ts`: unchanged.

### 5.3 Data-access layer

- `requireUserId()` (UC-01) stays the identity check.
- New `requireWorkspaceAccess(workspaceId, minimumAction)` in `src/server/auth/require-workspace-access.ts`, wrapped in `React.cache`. It calls `requireUserId()`, loads the membership, applies the §3 matrix for `minimumAction`, and returns `{ userId, workspaceId, role }`. Non-members → `WorkspaceNotFoundError`. Insufficient role → `WorkspaceForbiddenError`.
- Every service function takes the `WorkspaceAccess` object, not a raw `workspaceId`, so the check cannot be skipped by accident.
- `resolveActiveWorkspace()` reads the cookie, validates membership, falls back to the private workspace (§4.9).

### 5.4 Services

- `src/server/services/workspaces.ts`: `ensurePrivateWorkspace` (used by sign-in and migration verification), `createSharedWorkspace`, `renameWorkspace`, `setWorkspaceCurrency`, `addMember`, `changeMemberRole`, `removeMember`, `leaveWorkspace`, `deleteWorkspace`, `listMyWorkspaces`, `getWorkspaceDetails`.
- Existing services (`months`, `categories`, `templates`, `annuals`, `actuals`, `incomes`, `reserved-lines`, `pass-to-actual`, `pass-to-upcoming`, `move-actual`, `summary`, `estimate-check`, `global-stats`, `search`, `export`, `annuals`) change their first argument from `userId` to `WorkspaceAccess` and call the matrix action they need (§3). Domain rules do not change.
- Error classes: `WorkspaceNotFoundError`, `WorkspaceForbiddenError`, `WorkspaceEmailNotAllowedError`, `WorkspaceMemberNeverSignedInError`, `WorkspaceMemberExistsError`, `WorkspaceMemberNotFoundError`, `CannotRemoveOwnerError`, `OwnerCannotLeaveError`, `PrivateWorkspaceImmutableError`, `WorkspaceNameMismatchError`, `InvalidWorkspaceNameError`.

### 5.5 Actions

Thin server actions (Zod → `requireUserId()` → service → `revalidatePath('/[locale]', 'layout')`):

- `createSharedWorkspaceAction`, `renameWorkspaceAction`, `setWorkspaceCurrencyAction`
- `addWorkspaceMemberAction`, `changeWorkspaceMemberRoleAction`, `removeWorkspaceMemberAction`, `leaveWorkspaceAction`
- `deleteWorkspaceAction` (redirects to Home; clears the active cookie if it pointed there)
- `setActiveWorkspaceAction`

Every existing action gains a `workspaceId` from the active-workspace cookie, validated by `resolveActiveWorkspace()`. Export (UC-19) keeps returning file bytes and does not revalidate.

### 5.6 Sign-in

- `upsertUserOnSignIn` (UC-01) also creates the private workspace and its Owner membership in the same transaction on first insert. Subsequent sign-ins never create a second one.

### 5.7 Money

Unchanged. Every amount still crosses the wire as `^-?\d{1,12}\.\d{2}$`. Currency labels come from the workspace being viewed.

---

## 6. Migration 0008 — order of operations

Run in **one transaction**, forward-only.

**Preconditions (all required):**

1. **Both app instances are stopped** before the migration starts and stay stopped until the new build is running. Old code writes `user_id`; after step 5 that column is gone and the old code fails on every write (verified in the scratch run below).
2. Migrations 0000–0007 are applied and the ledger matches them.
3. A full backup is taken and restorable (`docs/database/README.md`). Restoring a pre-0008 dump needs the pre-0008 remap; a post-0008 dump uses `workspace_id`.
4. The migration is run once, by the migrator, not by hand.

**Verification run:** the steps below were executed on a scratch database built from the real migrations 0000–0007 with two users (one with a non-default currency, one with a shared category name and an inactive duplicate). Result: every per-user row count was identical before and after; each private workspace held exactly its owner's rows; actual expenses were attributed to their owner; a duplicate active category name inside one workspace was rejected by the new index, while the same name in two workspaces was accepted. Writes from old code failed with `column "user_id" of relation "category" does not exist`.

**Rollout consequence:** the migration is safe as a maintenance-window change (stop both instances, migrate, start the new build). It is **not** safe as a rolling deploy: an old instance still running after step 5 cannot write.

1. Create enums `workspace_kind` (`private`, `shared`) and `workspace_role` (`owner`, `admin`, `editor`, `reader`).
2. Create `workspace` and `workspace_member`, with the constraints in §4.7.
3. For **every** row of `app_user`: insert a private workspace (`personal_user_id = id`, `currency` from `profile_settings`, default `EUR`) and an `owner` membership.
4. Add nullable `workspace_id` to `category`, `template`, `annual`, `month`. Backfill each from the owner's private workspace via `month`/`category`/`template`/`annual.user_id`. Set `NOT NULL`, add the FK `ON DELETE CASCADE`.
5. Drop the old `user_id` indexes and columns on those four tables. Create the replacements:
   - `category_active_name_uk` on `(workspace_id, kind, name) WHERE active` (partial, as today).
   - `month_workspace_period_uk` on `(workspace_id, year, month)` (replaces `month_user_period_uk`).
   - `template_clone_idx` on `(workspace_id, active, kind)`; `annual_reminder_idx` on `(workspace_id, charge_month)`.
6. Add `month_actual_expense.created_by_user_id` (FK `app_user`). Backfill with the private workspace owner of that row's workspace. Set `NOT NULL`.
7. Verification in the same transaction, failing the migration if any check fails:
   - count of `month`, `category`, `template`, `annual`, `month_income`, `month_fixed_line`, `month_actual_expense` is unchanged;
   - for every `app_user`, the number of rows per table with `workspace_id = private workspace` equals the number of rows that had `user_id = app_user.id` before the migration (computed before step 4 into a temporary table).
8. Keep `profile_settings` (currency, theme). Do not touch `app_user`.

Migrations 0002–0007 are not edited.

---

## 7. Routes and screens

### 7.1 Home (`/[locale]`)

- **Single-workspace mode:** unchanged (§4.11).
- **Multi-workspace mode:** a **Workspaces** block at the top, then the active workspace's month list (or its empty state) below it.
  - Workspace card: name (or "My private workspace"), role badge (Owner / Admin / Editor / Reader — hidden for the private workspace), "Active" marker, and a "Shared" tag on shared ones.
  - Tapping a card calls `setActiveWorkspaceAction` and reloads Home.
  - "New shared workspace" link → Workspaces screen create form.

Design direction (layout only; visuals follow `docs/styles/STYLE-GUIDE.md` tokens, no new colours):

```
┌──────────────────────────────────┐
│ Home budget ▾             (chip) │   header: active workspace, opens Home list
├──────────────────────────────────┤
│ WORKSPACES                       │
│ ┌──────────────────────────────┐ │
│ │ ● Home budget       Editor   │ │   active: sky-tint surface, navy text
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │   My private workspace       │ │   no role badge
│ └──────────────────────────────┘ │
│ + New shared workspace           │
├──────────────────────────────────┤
│ 2026 and later                   │   the existing month list, unchanged
│ …                                │
└──────────────────────────────────┘
```

On desktop the cards sit in a row above the month list. The active workspace name is the only workspace indicator on the month workspace screens; no other label is added there.

### 7.2 Workspaces (`/[locale]/workspaces`) — new screen

- Lists the user's workspaces and the create-shared form (name, currency).
- `/[locale]/workspaces/[workspaceId]` (shared only; private → 404): details, members list with role controls (Admin+), add-member form (email + role), leave (non-owner), rename + currency (Admin+), delete with typed name (Owner). Ownership transfer controls arrive in UC-32.
- Reachable from the Home block and from the **More** menu on mobile, and from the sidebar on desktop, **only in multi-workspace mode** (§4.12). In single-workspace mode the only entry is the "Share with others" row in Settings (§4.11), which opens the create-shared form directly.

### 7.3 Settings (`/[locale]/settings`)

- Currency: edits the **active** workspace currency. Copy names the workspace in multi-workspace mode only.
- Theme: unchanged, per user.

### 7.4 Existing screens

Unchanged, reading the active workspace. Member-aware controls follow §3: disabled-by-absence, not greyed-out, for Reader and for another member's ticket.

---

## 8. i18n keys

Namespace `workspaces` (both locales; parity test applies):

- `workspaces.title`, `workspaces.new`, `workspaces.active`, `workspaces.shared`, `workspaces.privateLabel`, `workspaces.privateTag`
- `workspaces.roles.{owner,admin,editor,reader}` and `workspaces.roleHelp.*` (one sentence per role, copy from §3)
- `workspaces.create.*`, `workspaces.members.*`, `workspaces.leave.*`, `workspaces.rename.*`, `workspaces.currency.*`
- `workspaces.delete.*` (lead, counts as ICU plurals, typed-name prompt, confirm, cancel, pending, error)
- `workspaces.addedBy` ("Added by {name}")
- `workspaces.switcher.*` (open list, current)
- `validation.workspaceNameRequired`, `validation.workspaceNameTooLong`, `validation.workspaceEmailInvalid`, `validation.workspaceEmailNotAllowed`, `validation.workspaceMemberNeverSignedIn`, `validation.workspaceMemberExists`, `validation.workspaceMemberNotFound`, `validation.workspaceForbidden`, `validation.workspaceNotFound`, `validation.cannotRemoveOwner`, `validation.ownerCannotLeave`, `validation.workspaceNameMismatch`

Copy rules: plain verbs, sentence case, errors say what happened and what to do (e.g. "This person has not signed in yet. Ask them to sign in once, then add them again.").

---

## 9. Acceptance criteria

- A user who has never created a shared workspace sees no difference anywhere: same Home, same nav, same forms, same numbers (test scenario 80).
- Every pre-existing user has one private workspace after migration 0008 with every former row attached to it; counts are unchanged (scenario 78).
- Two different workspaces can each hold a month of the same year and month without conflict (scenario 89).
- Roles behave exactly as §3 says, enforced on the server, not only in the UI (scenarios 83–85).
- A member removed from a workspace loses access on the next request and keeps no copy of the data; their past tickets stay (scenario 90).
- A non-member cannot discover that a workspace exists (scenario 87).
- Deleting a shared workspace removes exactly its rows; other workspaces and every private workspace are untouched (scenario 86).
- Switching the active workspace changes every screen at once and clears the last-opened month (scenarios 88, 92).
- `docs/database/database.dbml`, `docs/database/README.md` and the seed script are updated in the same commit (dump remap now targets `workspace_id`).

---

## 10. Tests (PRD §15 scenarios 78–93)

Map to: `tests/unit/workspace-access.test.ts` (matrix as a pure table), `tests/integration/workspaces.test.ts` (78–79, 81–90, 93), `tests/integration/workspace-roles.test.ts` (83–85), `tests/e2e/workspaces.spec.ts` (80, 88, 91, 92, Spanish variant), plus every existing spec unchanged except the seed helper (`tests/e2e/_helpers/auth.ts` must also create the private workspace).

Scenarios:

78. Migration backfill: an existing user with months, categories, templates, annuals and actuals ends with one private workspace holding all of them; row counts are unchanged.
79. First sign-in creates exactly one private workspace with an Owner membership; a second sign-in creates no second one.
80. A user with only the private workspace sees the current Home and nav; no workspace text, chip, switcher or "Added by" appears anywhere.
81. Creating a shared workspace makes the creator its Owner and leaves the private workspace untouched.
82. Adding a member: an allowlisted user who has signed in is added; a non-allowlisted email is rejected and nothing is stored; an allowlisted user who never signed in is rejected with the sign-in-first message; a duplicate is rejected; the Owner role cannot be assigned.
83. Reader: sees every report and screen of the workspace; every write is rejected by the server; the UI shows no write control.
84. Editor: creates a month and a category, adds an actual; cannot delete a month, rename or deactivate a category, or touch incomes, templates, annuals or reserved lines; can edit and delete only the actuals they created.
85. Admin: full data access except delete-workspace and ownership transfer; adds, re-roles and removes members; cannot touch the Owner.
86. Owner deletes a shared workspace: the typed name is required; every row of that workspace is gone; other workspaces and every private workspace are untouched; a private workspace cannot be deleted.
87. A user who is not a member gets the same not-found answer for a real workspace id and for a random one, on every route and action.
88. Switching the active workspace changes Home, History, Categories, Fixed, Annuals, Stats, Search, Export and Settings together; a stale cookie for a workspace the user left falls back to the private workspace.
89. The same year and month can exist once in the private workspace and once in a shared one; creating one never affects the other. Overspend and savings figures never mix the two.
90. Removing a member ends their access on the next request; their past actuals stay in the workspace, attributed to them.
91. A non-owner member can leave; the Owner cannot leave while the workspace exists.
92. The last-opened-month cookie resumes only a month of the active workspace; switching workspace clears it.
93. Changing the currency of a shared workspace relabels only that workspace; the private workspace keeps its currency.

---

## 11. Decisions taken while drafting (PO to confirm)

The request fixed the four roles and the "private by default" rule. These details were not stated, so the slice decides them. Each is one line to change if the Product Owner wants otherwise.

1. **Editor cannot change categories** (no rename, deactivate or savings flag). Strict reading of "create new categories (not deleted categories)".
2. **Editor manages only its own expenses** (edit and delete). The request names delete; edit is treated the same way.
3. **Incomes, templates, annuals, reserved lines and move/undo stay Admin+.** The request lists only months, categories and expenses for Read/Write.
4. **Members must have signed in once.** No pending invitations in V1.
5. **Admin can remove another Admin** (but never the Owner).
6. **The Owner cannot leave**; they transfer ownership (UC-32) or delete the workspace.
7. **Currency is per workspace** (confirmed by the PO 2026-11-27). It is stored on `workspace.currency` and inherited from `profile_settings.currency` at creation. `profile_settings.currency` mirrors the private workspace's currency and is the default for new shared workspaces. A shared workspace keeps its currency across owner changes (UC-32). See §4.2.4.
8. **Private workspace has no name and no members.**
9. **No cap on shared workspaces per user.**

---

## 12. Non-goals (this slice)

- Invitations or memberships for people who have not signed in.
- Public or link-based sharing; sharing with anyone outside `ALLOWED_EMAILS`.
- Custom roles, per-category or per-month permissions.
- Audit log screen (only `created_by_user_id` is stored).
- Moving rows between workspaces; copying or merging workspaces.
- Notifications of any kind.

---

## 13. Depends on / unlocks

- Depends on: UC-30 (and through it every tenant slice: UC-01, UC-03, UC-05, UC-06, UC-08, UC-09, UC-14, UC-24).
- Unlocks: UC-32 (ownership transfer).
- Schema: **migration 0008** (PO decision 2026-11-27). This is the first change to tenancy columns since UC-00.
