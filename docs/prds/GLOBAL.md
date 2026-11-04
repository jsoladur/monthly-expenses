# Monthly Expenses — Product Requirements (AI-agent optimized)

> **Audience:** coding agents and humans implementing the product.  
> **Status:** MVP specification — money rules confirmed.  
> **Scope rule:** describe *what* the product must do. Do not invent UI libraries, frameworks, or cloud vendors beyond constraints already decided by the Product Owner.  
> **Public URL:** https://expenses.jmsola.dev

---

## 1. Mission

A personal Progressive Web App where an allowlisted user tracks **one calendar month at a time**: incomes, reusable categories, **fixed** commitments, **estimated** envelopes, and **actual** tickets. From day one of a new month, committed/estimated money is already reserved so **potential savings** is visible immediately. A separate **Annuals** catalog reminds the user of once-a-year charges in the matching calendar month; it never creates money rows by itself.

**Primary job-to-be-done:** open a month, see remaining savings, add a real expense in a few taps, optionally reduce an estimate by hand.

A **Search** screen finds already-recorded actual tickets across years by name or notes (read-only). It does not replace History or the month workspace.

Home can **export** created months to an Excel workbook (one sheet per month). It does not replace Stats or the month workspace.

**Not V1 (explicit future):** year view, category totals across months, and other reports. Do not build them now. Keep the model compatible later (stable categories, months, amounts).

---

## 2. Decided constraints (do not reopen in MVP)

| ID | Constraint |
| --- | --- |
| C1 | Multi-tenant: many users may use the app in parallel. All money data is isolated by user. |
| C2 | Access: Google sign-in + **hardcoded Gmail allowlist** from an environment variable (comma-separated). |
| C3 | Non-allowlisted Google user → **HTTP 403**, no app shell, no data. |
| C4 | Languages: English and Spanish. Locale from **browser** or **persisted cookie**. |
| C5 | Hosted server app. Runtime shape: **Docker Compose** with **app + PostgreSQL** (minimum). |
| C6 | Period = **calendar month + year**, created **only manually** (user picks month/year). Never auto-create a month. |
| C7 | Unused grocery/estimate leftovers **die at month end** (no automatic rollover). Each month is a **separate instance**. |
| C8 | Past months remain **editable**, with a **warning**. |
| C9 | Currency is per-user in `profile_settings`, **default EUR**, always **2 decimal places**. Amounts **may be negative**. Amount **input** format: `1234.56` (dot decimal). |
| C10 | Categories are **per-user global catalogs**, not cloned as category definitions per month. **Logical (soft) delete** for categories and other catalog CRUDs. |
| C11 | MVP is **online web**. Offline sync is out of scope. PWA install is still required. |
| C12 | Home never invents a month. User opens an existing month or creates one. **Last opened month** is stored in a cookie. |
| C13 | Expense **name** is free text. On the add-actual form, names from **this month + the two previous calendar months** may autocomplete after two characters (prefix, case-insensitive, accent-folded). Selecting a suggestion fills the **name only**. |
| C14 | Attachments, merchant, payment method = **future**, not MVP. |
| C15 | **Hard delete** for month-scoped money rows (incomes, actual expenses, month fixed/estimated lines). |
| C16 | Reports (year view, category totals) = **not V1**, planned later. |
| C17 | At **create month**, active fixed + estimated **templates that apply to that month-number** (C23) **are cloned** into that month instance. After that, the month lives on its own. |
| C18 | Overspend warning: actuals in a category vs **sum of active template amounts** (committed + estimated) **that apply to the open month-number** (C23) in that category. Warn only, never block. |
| C19 | **Annuals** are a per-user catalog of yearly expenses. They **remind** in the matching calendar month (any year) and **never** auto-create month lines (same philosophy as C6/C12). |
| C20 | **Search** finds the user’s own `month_actual_expense` rows by **name or observations** across every created month. Read-only. Explicit submit (not the add-actual autocomplete — that is C13 / UC-22). |
| C21 | **Pass to upcoming month** moves an **estimated** reserved line to a **later month of the same calendar year that already exists**. Current year only. Not History. Never auto-creates the target (C6). Not automatic leftover rollover (C7). |
| C22 | **Excel export** downloads the signed-in user’s created months as one `.xlsx` workbook, one sheet per month. Scopes: all months, one or more years that already have months, or a checked set of created months. Year and month pickers are descending. Read-only. Never auto-creates a month (C6). |
| C23 | **Template month schedule + hard delete.** A template may be limited to a set of calendar month-numbers (1–12). No schedule (`NULL`) = every month; a schedule with all 12 months is stored as no schedule; an empty schedule is invalid. A template can also be **hard-deleted** from the catalog (besides deactivate). Neither change rewrites months that already exist. |
| C24 | **Savings categories.** An expense category may be flagged **counts as savings** (never an income category). Its money is recorded exactly like any other expense and still leaves the available money; only **reporting** separates it: the month summary splits **spending** from **invested**, Global Stats excludes it from spend, and it raises no overspend warning. The flag lives on the category only and reclassifies every month on the next read without rewriting any amount. |
| C25 | **Estimate check.** Per open month and expense category with estimated lines, the app compares what is still reserved with what tickets already spent and **suggests** a remaining. It flags a *possible overlap* only — a ticket has no link to its envelope. Nothing changes until the user confirms a fix (never auto-balance, §7.3). |
| C26 | **Move an actual expense** to another month the user already created: any later month (across years) or up to **3 calendar months back** from the ticket's own month. The row moves (same id and fields); it is never copied. Never auto-creates the target (C6). No undo — the user moves it back. |
| C27 | **Delete a month.** A month header can be hard-deleted with all its incomes, reserved lines and actuals (cascade), behind a typed confirmation of the month label. Catalogs are untouched. Home never auto-picks or creates a replacement (C6/C12). |
| C28 | **Annual reminder "added" state.** When the open month already holds a reserved line or actual in the annual's category whose folded name equals or starts with the annual's folded name, the reminder collapses to an **Added** row. Computed at read time; nothing links a line to an annual; the reminder never disappears. |

---

## 3. Actors

| Actor | Meaning |
| --- | --- |
| Visitor | Not signed in. Can only start Google sign-in. |
| Blocked Google user | Authenticated with Google, email not on allowlist. Sees 403 only. |
| User | Allowlisted. Owns categories, months, incomes, fixed/estimated lines, actuals, annuals, profile settings. |
| Coding agent / implementer | Builds exactly this spec. Must not share data across users. |

There is **no household sharing** in MVP. Tenancy = one user account.

---

## 4. Glossary (use these terms in code comments and UI copy keys)

| Term | Definition |
| --- | --- |
| **Month instance** | A user-owned period (`year` + `month` 1–12). Isolated working copy. Created only when the user asks. |
| **Income** | Money in for that month. Fields: income category, name, amount. No observations. |
| **Actual expense** | Money already spent (ticket). Fields: expense category, name, observations (optional), amount. Any number per month. |
| **Fixed expense (committed)** | Recurring real commitment (e.g. mortgage). Cloned into the month and **reserved**. Can **cut-paste** to Actuals in one action. |
| **Estimated expense (envelope)** | Recurring *plan* (e.g. groceries, car gas). Cloned into the month. **Cannot** be passed to actuals. Remaining is **edited manually**. Actual tickets do **not** auto-reduce the envelope. |
| **Template line** | User’s reusable fixed/estimated definition (management form). Used **only at the moment a month is created** (clone source). |
| **Remaining fixed** | Current amount still reserved on a month’s fixed/estimated line (after manual edits). |
| **Plan amount (overspend baseline)** | Sum of **active** template amounts (committed + estimated) on the **template form** for that category. Not the remaining box in the month. |
| **Potential savings** | See §7. |
| **Pass to actual** | One-tap **cut and paste**: remove committed fixed line from the month’s fixed block; create an equivalent actual row. Undo = reverse **only while the actual was not edited**. |
| **Pass to upcoming month** | One-tap **cut and paste** of an **estimated** line onto a later created month of the **current year**. The line leaves this month’s Estimated tab and appears there as a month-only estimate. No undo. |
| **Annual** | Yearly recurring expense reminder (insurance, vehicle tax). Catalog only — not cloned, not a spend series. |
| **Search** | Read-only finder of actual tickets by name or observations, any year. Not History (browse months) and not Stats (aggregates). Distinct from add-actual name autocomplete (UC-22). |
| **Export** | Read-only Excel download of created month workspaces (incomes, actuals, committed, estimated, summary totals). Lives on Home. Not Stats (aggregates) and not a catalog dump. |
| **Logical erase** | Soft-delete / deactivate catalogs (categories, templates, annuals). Hidden from new pickers and from annual reminders. Month rows that already reference a category/template keep the id. |
| **Hard delete** | Row removed. Used for month incomes, month actuals, month fixed lines. |

---

## 5. Multi-tenancy and identity

### 5.1 Isolation invariant

Every query/mutation for months, categories, incomes, expenses, templates, annuals, and settings **must** be scoped to `user_id` of the session. No user can read or write another user’s rows. Agents: treat missing `user_id` filter as a **P0 bug**.

### 5.2 Allowlist

- Source: env var, comma-separated emails (normalize: trim, lowercase).
- Check **after** successful Google identity, **before** any app data.
- Failure: **403 Forbidden** page (i18n). Do not create tenant data for blocked users.

### 5.3 Profile settings

Logical entity `profile_settings` (1:1 user):

- `currency` — default `EUR`

### 5.4 Cookies

- Language (`en` | `es`)
- Last opened month (`year` + `month`) so the same browser can resume that month. Not a security boundary.

---

## 6. Information model (logical)

Agents may normalize tables as needed if **behavior and fields** stay equivalent.

### 6.1 User (from Google)

- Stable id, email, display name/avatar optional.

### 6.2 ExpenseCategory / IncomeCategory (per user, global)

| Field | Rules |
| --- | --- |
| name | Mandatory, unique per user + type among **active** rows |
| active / not deleted | Soft-delete only |
| type | expense **or** income |
| counts_as_savings | Boolean, default false. **Expense only** (rejected on income). Reporting flag (C24); never changes stored amounts. Soft-deleted categories keep it |

**Soft-delete / deactivate:** cannot be chosen for **new** actuals, incomes, or new template lines. Existing month rows still display the name. Reactivate allowed.

### 6.3 Fixed/Estimated template (per user, global management form)

| Field | Rules |
| --- | --- |
| expense_category | Mandatory |
| name | Mandatory, free text |
| observations | Optional |
| amount | Mandatory, 2 decimals, **may be negative** |
| kind | `committed` **or** `estimated` |
| months | Optional schedule: set of month-numbers 1–12. **Absent = every month.** All 12 selected = every month (stored as absent). At least one month when set. Only templates that apply to a month-number are cloned into a new month of that number (C23). |
| active | Soft-delete; inactive templates are **not** cloned into **new** months |

Clone source only. Never updated from month edits. **Delete:** deactivate (soft, reversible) **or** delete (hard, permanent — the row is gone from the catalog; months already created keep their copied lines).

### 6.4 Month (per user)

| Field | Rules |
| --- | --- |
| year, month | Unique together per user |
| created_at | — |

Creating a month that already exists: **reject** (do not clone twice). Months are never created implicitly.

### 6.5 MonthIncome

| Field | Rules |
| --- | --- |
| month | Mandatory |
| income_category | Mandatory, must be active **at creation** |
| name | Mandatory |
| amount | Mandatory, 2 decimals, may be negative |

No observations. **Hard delete.** Not cloned from templates.

### 6.6 MonthFixedLine (clone result + optional one-offs)

| Field | Rules |
| --- | --- |
| month | Mandatory |
| expense_category | Copied or chosen |
| name | Copied or chosen |
| observations | Optional |
| remaining_amount | Starts as cloned amount; user may **manually** change |
| original_amount | Amount at insert/clone time |
| kind | `committed` \| `estimated` |
| origin | `cloned` \| `month_only` (optional but useful) |

**Hard delete** of a month line does not change templates.

### 6.7 MonthActualExpense

| Field | Rules |
| --- | --- |
| month | Mandatory |
| expense_category | Mandatory; must be active at **creation** |
| name | Mandatory. Free text. Add-form autocomplete: see UC-22. |
| observations | Optional, may be empty |
| amount | Mandatory, 2 decimals, may be negative |

**Hard delete.** Unlimited actuals per month. Never cloned.

### 6.8 Annual (per user, global catalog)

| Field | Rules |
| --- | --- |
| expense_category | Mandatory; must be **active** at creation |
| name | Mandatory |
| observations | Optional |
| amount | Optional reference amount (2 decimals, may be negative). Shown on the reminder when set |
| charge_month | 1–12 — month of the year when it is usually charged |
| is_direct_debit | Boolean; display badge only |
| active | Soft-delete; inactive annuals raise **no** reminders |

Catalog only. Not cloned into months. Nothing on a month row references an annual.

---

## 7. Money rules (normative)

All sums use 2 decimals. User types amounts as `1234.56`.

### 7.1 Potential savings (confirmed)

```
potential_savings =
    SUM(month incomes)
  − ( SUM(month actual expenses) + SUM(month fixed/estimated remaining_amount) )
```

Hard-deleted rows are excluded from sums.

**Savings split (C24).** Each expense amount is classified by its category's `counts_as_savings` flag:

```
spending     = Σ actuals (non-savings categories) + Σ remaining (non-savings categories)
invested     = Σ actuals (savings categories)     + Σ remaining (savings categories)
left_over    = Σ incomes − spending − invested     ← identical to potential_savings above
total_saved  = left_over + invested
```

`left_over` is the same number as `potential_savings` (UI copy "Left over" / "Sobrante"). Negatives stay algebraic (§7.6): a negative actual in a savings category lowers `invested`. "Invested" and "Total saved" only show for a month that has at least one savings-category row.

### 7.2 No double-count

- A line lives in **either** `MonthFixedLine` **or** `MonthActualExpense`, never both.
- **Pass to actual** moves the row (cut-paste). After move, it is **only** in actuals.
- **Pass to upcoming month** moves an estimated line from this month instance to a later created month of the same year. After the move it is **only** on the target month.
- **Move an actual** (C26) changes only the ticket's month. After the move it is **only** on the target month.
- Manual estimate decrease does **not** create an actual.
- Adding an actual does **not** change any remaining automatically.

### 7.3 Estimates vs tickets (confirmed)

1. Month starts with estimated line remaining = cloned plan (e.g. 400.00).
2. User adds as many actual tickets as they want.
3. User **manually** reduces the estimate remaining (e.g. 400 → 280).
4. If they forget step 3, **both** the tickets **and** the remaining still hit savings. UI must make remaining obvious and easy to edit.

### 7.4 Overspend warning (confirmed)

**Do not** compare actuals to the month **remaining** box.

- **Left:** `SUM(actual tickets)` in that expense category for the open month.
- **Right:** `SUM(active template amounts)` in that same category (committed **and** estimated) **whose schedule applies to the open month-number** (C23). For templates without a schedule this is the same total as Fixed Expenses → Distribution by category.  
  Example: templates “Groceries 400” + “Extra 50” in Food → plan = **450**. Actuals 500 → **warning**. Housing “Rent 700 committed” + “Repairs 160 estimated” → plan = **860**. Utilities “Water 60” scheduled {Jan} + “Power 50” → January plan = **110**, February plan = **50**.

If a category has **no applicable active templates** for the open month, **no** overspend warning for that category.

**Savings categories (C24) never raise an overspend warning.** Investing more than the plan is not overspending.

**Warn only. Never block.** Remaining on a month line may be zero or negative if the user types it.

### 7.5 Pass to actual (committed and estimated)

- Allowed for **both** `kind = committed` and `kind = estimated`.
- One tap: remove fixed line; insert actual with same category, name, observations, amount = **current remaining_amount**.
- **Undo:** only if the actual **has not been edited** after the move.
- After the user edits the actual, **no** un-convert. They may hard-delete the actual and add a month line if needed.
- After convert, user may edit the actual amount.
- Undo restores the line with its original kind (committed or estimated).

### 7.6 Negative amounts

Allowed on incomes, actuals, and fixed/estimated. Totals are algebraic sums.

### 7.7 Past months

All edits allowed. Persistent **warning** if the open month is not the current calendar month.

### 7.8 Month instances and cloning (confirmed)

```
Templates (global kit)
        │
        │  ONLY at "create month"
        ▼
Month instance (Aug 2026)     Month instance (Sep 2026)
  cloned reserved lines         cloned from templates
  + any actuals the user adds     as they exist at Sep create
  + any one-off reserved lines    independent of August
  edits stay in August
```

Rules:

- Each month is a **separated instance**.
- Clone happens **once**, at create time, from **active** fixed + estimated templates **whose schedule includes the new month's month-number** (no schedule = every month, C23).
- After create, August and September never sync to each other or back to templates.
- User may add **any number of actual expenses** on a month.
- User may add or hard-delete reserved lines **only on that month** (one-offs). They are not written to the template and will not appear in the next month unless added to the template before that month is created.
- Changing, rescheduling, soft-deleting, or hard-deleting a template does **not** rewrite months that already exist.
- Unused remaining in August does **not** roll into September automatically (C7). The user may **manually** pass an estimated line to a later created month of the current year (UC-23 / C21).

### 7.10 Pass estimated line to an upcoming month (confirmed)

- Allowed only for `kind = estimated`.
- Allowed only when the source month’s year is the **current calendar year**.
- Target must be an **already created** month of the **same year** with a **later** month number.
- One transaction: insert the line on the target (`origin = month_only`, remaining = original = source remaining, same category / name / observations); HARD-delete the source line.
- Never auto-creates the target month.
- No undo. History / previous years do not offer this action.
- Templates are not rewritten. Months still do not sync after create (§7.8).

**Incomes are not cloned** (not MVP).

### 7.9 Annual reminders

When the open month’s month-number matches an annual’s `charge_month`, show one **informational** reminder per matching **active** annual (any year — September 2026 and September 2027 both match `charge_month = 9`). Reminders are **not** overspend warnings (those stay amber per §7.4).

- **Never** auto-create a reserved line or actual (C6/C12/C19).
- Quick-add may **prefill** a month-only reserved-line form (name + category); the user still confirms kind and amount.
- Reminders do **not** disappear after the user adds a line (no dismissal in V1).
- **Added state (C28).** An annual is *matched* when any reserved line (committed or estimated) or actual of the open month has the annual's category **and** a folded name (accent- and case-insensitive, whitespace collapsed — same folding as Search) that equals or starts with the annual's folded name. First match: reserved lines before actuals, then by name. A matched reminder collapses to one row — “Added: {line name} · {amount}” (reserved lines show their original amount) — with a **Show details** toggle that expands the full card; quick-add is not offered on it. Unmatched reminders are listed first, and the header count shows only unmatched ones. Hard-deleting the matching line brings the full reminder back on the next render.
- Soft-deleted annuals raise no reminders.

### 7.11 Estimate check (confirmed)

Per open month and expense category that has at least one estimated line (C25):

```
plan       = Σ original_amount   of the category's estimated lines
remaining  = Σ remaining_amount  of the category's estimated lines
tickets    = Σ actual amounts in the category, excluding tickets created by pass-to-actual
suggested  = max(plan − tickets, 0)
```

- **Flagged** when `remaining > suggested` — a *possible overlap*, never “counted twice”. The card lists the category's tickets so the user decides.
- Pass-to-actual tickets are listed but **not counted**: that move already removed their line from `plan`.
- **Set to plan − tickets** distributes `suggested` over the category's estimated lines in name order: each keeps `min(its remaining, what is left)`, later lines go to 0.
- **Release all** sets every estimated line of the category to 0. Offered only on months before the current calendar month.
- Every fix is explicitly confirmed and runs in one transaction. Committed lines and templates are never touched. Adding a ticket still never changes a remaining (§7.3).

### 7.12 Move an actual expense (confirmed)

Compare months as `index = year × 12 + (month − 1)`; S is the ticket's month (C26).

- Allowed target T: a month the user **already created**, `T ≠ S`, and either `index(T) > index(S)` (any later month, across years) or `index(S) − 3 ≤ index(T) < index(S)`.
- The window is relative to the ticket's month, not today.
- The row keeps id, category, name, observations, amount and creation time. An inactive category does not block the move.
- A pass-to-actual ticket that is moved counts as **edited**: its undo (§7.5) is no longer offered.
- Both months' summaries and overspend warnings recompute on the next read. A move may cause an overspend warning on the target (warn only).
- No allowed target → the action is hidden for that ticket.

---

## 8. Month lifecycle

```
[User has templates + categories]
        │
        ▼
[User creates Month(year, month)] ── if exists ──► error
        │                    never auto-created
        ▼
Clone active fixed/estimated templates that apply to this month-number → MonthFixedLine
        (template.months IS NULL or contains month)
        remaining_amount = template.amount
        original_amount  = template.amount
        kind             = template.kind
        │
        ▼
User adds MonthIncome(s) for this month
        │
        ▼
potential_savings already subtracts all remainings
        │
        ├─► add/edit/hard-delete any number of actual tickets
        ├─► manually edit remaining on estimated (and committed) lines
        ├─► add/hard-delete month-only reserved lines
        ├─► Pass to actual (committed only)
        ├─► Pass estimated line to an upcoming created month (current year)
        └─► undo pass only if actual not edited
```

---

## 9. Use cases and acceptance criteria

### UC-01 — Sign in with Google (allowlisted)

- Allowlisted Google auth → app. First visit creates user + `profile_settings.currency = EUR`.

### UC-02 — Sign in rejected

- Not allowlisted → **403**, no tenant rows, no months.

### UC-03 — Language

- `en` / `es`. Browser locale if those, else English. Switch persisted in cookie.

### UC-04 — PWA install

- Installable. Permanent install control if browser reports not installed. Online-only data OK.

### UC-05 / UC-06 — Categories

- Per-user expense and income categories. Soft-delete. Inactive hidden from new pickers. History keeps names.

### UC-07 — Template management

- Catalog of reserved lines: category, name, amount, `kind`, optional month schedule (UC-25). Soft-delete → not cloned later; existing months unchanged. Hard delete available (UC-25).

### UC-08 — Create calendar month

- User picks month + year.
- Duplicate rejected.
- Active templates that apply to the picked month-number cloned **once** into the new instance (C23).
- Nothing created automatically.

### UC-09 — Add income

- Category, name, amount required. Hard delete. Not cloned.

### UC-10 — Add actual expense

- Category, name, amount required. Observations optional.
- Unlimited tickets. Does not change remainings. Hard delete.
- Add-form name field may autocomplete recent names (UC-22).

### UC-11 — Manually decrease estimate

- Edit `remaining_amount`. No actual created.

### UC-12 — Pass committed to actual

- Only `kind = committed`. Cut-paste. Undo only if actual unedited.

### UC-13 — Edit past month

- Warning + edits allowed.

### UC-14 — Home / month navigation

- Never auto-create.
- Cookie last-opened month if it exists; else month list (newest first) + create.
- Empty state: create month only.
- Summary: income, actuals, remaining reserved, potential savings.

### UC-15 — Currency

- Label + 2 decimals. No FX conversion.

### UC-16 — Negative amounts

- Accepted; algebraic totals.

### UC-17 — Parallel users

- Full data isolation.

### UC-18 — Month-only reserved line

- Add/hard-delete on one instance only. Next month clone ignores it unless it was added to templates before create.

### UC-19 — Instance isolation

- Edit August remaining or add August actuals. Create September → September matches **current templates**, not August’s working copy.

### UC-20 — Annuals (yearly reminders)

Implementation slice: `docs/usecases/UC-14-annuals.md` (PRD **UC-14** remains home / month navigation).

- Per-user catalog of yearly expenses (category, name, optional amount, charge month 1–12, optional direct-debit flag). Soft-delete.
- Management screen sorted by charge month (locale month names).
- Open month whose month-number matches `charge_month` → one reminder card per active annual. Inactive → no reminder.
- User B never sees user A’s annuals.
- Never auto-creates month lines. Quick-add prefills a one-off reserved line; nothing is written until the user confirms.

### UC-21 — Search (find actual expenses)

Implementation slice: `docs/usecases/UC-16-search.md` (PRD **UC-16** remains negative amounts).

- Signed-in user opens **Search** (first-class destination; on mobile it lives under **More**).
- Form: one text field + **Search** button. Submit runs a tenant-scoped SQL `LIKE` on `month_actual_expense.name` **OR** `observations` after sanitizing the query (trim, collapse spaces, fold accents, lowercase, escape `LIKE` wildcards).
- Results are **read-only** ticket rows (same visual as the month-workspace actuals list, without edit/delete/undo). Grouped by year then month. Tapping a row opens that month workspace.
- User B never sees user A’s tickets.
- Does not search incomes, reserved lines, templates, or categories. Does not live-autocomplete as the user types (explicit Search button). Add-actual name autocomplete is UC-22 / C13, not this screen.

### UC-22 — Actual name autocomplete (add-ticket form)

Implementation slice: `docs/usecases/UC-17-actual-name-autocomplete.md` (PRD **UC-17** remains parallel users).

- On the month workspace Actuals tab, the add-ticket **name** field (`#new-actual-name`) offers up to **five** recent names once the user has typed **two** characters.
- Source: this user’s `month_actual_expense.name` in the **open month + the two previous calendar months**. Prefix match after accent-fold and lowercase. Duplicate folded names collapse to the newest spelling.
- Selecting a suggestion fills the name only. Category, observations, and amount stay as the user left them.
- User B never sees User A’s names.
- Does not search observations, incomes, or reserved lines. Does not change Search (UC-21). Missing prior months are skipped (C6).

### UC-23 — Pass estimated line to an upcoming month

Implementation slice: `docs/usecases/UC-18-pass-to-upcoming-month.md` (PRD **UC-18** remains month-only reserved lines).

- On the month workspace Estimated tab, **Pass to upcoming month** appears only when later months of the **current calendar year** already exist.
- Hidden on History (`?from=history`) and on any month whose year is not the current calendar year.
- Picker lists only created months with the same year and a later month number. Never auto-creates a month (C6).
- Confirm cut-pastes the estimated line: hard-delete on the source month; insert on the target as `kind = estimated`, `origin = month_only`, remaining = original = source remaining.
- Committed lines, other years, and missing targets are rejected. No undo.
- User B never moves User A’s lines.

### UC-24 — Excel export of month expenses

Implementation slice: `docs/usecases/UC-19-excel-export.md`.

- Signed-in user opens **Export** on Home. A picker offers **All**, **Select by year**, or **Select specific months**.
- Year options are only years that already have at least one `month` row, newest first; **more than one year can be checked**. Month options are only created `(year, month)` rows, newest first.
- Download is an `.xlsx` file with **one sheet per exported month** (newest first). Each sheet lists Incomes, Actuals, Committed, Estimated, and the same summary totals as the workspace (PRD §7.1). No charts.
- User B never sees User A’s months, including via a crafted year or period list.
- Does not export catalogs (categories, templates, annuals). Does not create months (C6). Does not import.

### UC-25 — Fixed expense hard delete & month schedule

Implementation slice: `docs/usecases/UC-20-fixed-expense-delete-and-schedule.md`.

- On Fixed expenses, every template row (active or inactive) offers **Delete**. After confirmation the template is permanently removed. Months already created keep their copied lines.
- Add and edit forms offer **Only in some months**. Off = applies every month (default). On = a 12-month picker that starts empty (or restores the months picked before it was switched off in the same form); the user selects the months that apply. At least one month must remain selected. All 12 selected is saved as "every month".
- Creating a month clones only active templates that apply to that month-number.
- The overspend plan for a month counts only templates that apply to that month-number.
- Rows with a schedule show which months apply.
- User B can never delete or reschedule User A's templates.

### UC-26 — Savings categories

Implementation slice: `docs/usecases/UC-24-savings-categories.md`.

- On Expense categories, each row and the add form offer **Counts as savings** (off by default). Flagged rows show a piggy-bank badge. Income categories never offer it; the server rejects it.
- Month summary: Income · Spending · Invested · **Left over** · Total saved (§7.1). Invested and Total saved appear only when the month has savings-category rows.
- The month Stats tab pie excludes savings categories and shows one Invested figure.
- Savings categories raise no overspend warning (§7.4).
- Global Stats: spend, remaining, household cost change and category creep exclude savings categories; an Invested series is added. Selecting a savings category in the category filter labels it “(savings)”.
- Excel export adds Invested and Total saved rows on sheets whose month has savings rows.
- Flipping the flag reclassifies every month on the next read and changes no stored amount. User B cannot toggle User A's category.

### UC-27 — Estimate check

Implementation slice: `docs/usecases/UC-25-estimate-reconciliation.md`.

- The month workspace has an **Estimate check** tab (after Data). Its badge counts flagged categories; there is no extra banner.
- One card per expense category with estimated lines: plan, remaining, counted tickets, suggested remaining, and the category's ticket list (pass-to-actual tickets marked, not counted).
- **Set to plan − tickets** and, on past months, **Release all** — each behind an inline confirmation (§7.11).
- User B can neither read nor apply the check on User A's month.

### UC-28 — Move an actual expense to another month

Implementation slice: `docs/usecases/UC-26-move-actual-expense.md`.

- On the Actuals tab, each ticket offers **Move to another month** when at least one allowed target exists (§7.12).
- The picker lists previous (up to 3 back) and upcoming created months, each with its left-over figure (“Saved” for closed months).
- After the move a notice links to the target month. Moving a pass-to-actual ticket warns that undo is lost.
- User B cannot move User A's ticket, nor move a ticket into User A's month.

### UC-29 — Delete a month

Implementation slice: `docs/usecases/UC-27-delete-month.md`.

- The month header's actions menu offers **Delete month**. The confirmation lists how many incomes, reserved lines and actuals will go, and enables Delete only once the user types the month label exactly as the header shows it (trimmed, case-insensitive; Spanish “noviembre de 2026”).
- Deleting removes the month and all its rows in one transaction. Templates, categories and annuals are untouched.
- If the last-opened cookie points at it, the cookie is cleared. The user lands on Home (month list) with a one-time note; no month is created.
- The same month can be created again later; it clones **today's** applicable templates.
- User B cannot delete User A's month.

### UC-30 — Annual reminder “already added” state

Implementation slice: `docs/usecases/UC-28-annual-reminder-added-state.md`.

- A reminder whose annual is matched in the open month (§7.9, C28) collapses to “Added: {line name} · {amount}” with a check icon and a keyboard-accessible **Show details** toggle.
- The same name in another category does not match; a name that only contains the annual's name mid-string does not match.
- Hard-deleting the matching line restores the full reminder on the next render.

---

## 10. Screens (logical)

1. Sign-in  
2. 403  
3. Month list / empty + create month  
4. Month workspace — header actions menu (Delete month) + summary (Spending / Invested / Left over / Total saved) + **annual reminders (when the month-number matches; “Added” rows when matched)** + tabs: Data (incomes, reserved lines, actuals — add-actual name may autocomplete recent names; each actual may be moved to another month), **Estimate check**, Stats, Help  
5. Expense categories — with **Counts as savings** switch  
6. Income categories  
7. Fixed/estimated templates — with optional month schedule and Delete  
8. Profile settings — currency  
9. Language switcher  
10. Install PWA — if not installed  
11. Annuals catalog — yearly reminders, grouped by charge month  
12. Search — find actual tickets by name or note, any year  
13. Home export picker — All / year / specific months → Excel download  

Mobile-first: add an actual from the month workspace. The add-actual name field autocompletes recent names after two characters (inline list, max five). Search is first-mobile: field + button, then a year-banded ticket list. Export is a Home header button that opens a bottom sheet.

---

## 11. i18n

- All user-facing strings keyed. Locales `en`, `es`.
- Month names follow locale.
- Amount input: `1234.56` in both locales.
- Translate 403, validation, past-month warning, overspend warning, annual reminders, search idle/empty/too-short, actual-name autocomplete list label, pass-to-upcoming-month picker, export picker and workbook section labels, savings labels (Spending / Invested / Left over / Total saved), estimate check, move-to-month picker and notice, delete-month confirmation, annual reminder “Added” state.

---

## 12. PWA

- Installable on smartphone.
- Permanent install affordance when not installed.
- Online-only data acceptable.

---

## 13. Delete policy

| Entity | Delete |
| --- | --- |
| Expense / income categories | Soft |
| Templates (fixed/estimated catalog) | Soft (deactivate) **and** Hard (explicit Delete, C23) |
| Annuals (yearly reminder catalog) | Soft |
| Other catalog/settings CRUDs | Soft |
| Month incomes | Hard |
| Month actual expenses | Hard |
| Month fixed/estimated lines | Hard |
| Month header | Hard, explicit **Delete month** with typed confirmation; children cascade (C27) |

---

## 14. Explicit non-goals (V1)

- Household / shared months
- Admin UI for allowlist
- Offline-first sync
- Autocomplete on the **edit**-ticket name field, or filling category/amount from a suggestion
- Attachments, merchant, payment method
- Auto-create month
- Auto-rollover of unused estimates
- Auto-reduce envelope when adding a ticket
- Syncing an existing month back to templates or to other months
- Pass-to-actual on estimates
- Undo pass-to-actual after the actual was edited
- Physical delete of categories
- FX conversion
- Reports (year view, category totals, charts) — future
- Income templates / cloning incomes
- Auto-create reserved lines or actuals from annuals
- Dismiss / hide an annual reminder after adding a line (future)
- Auto-create a month in order to pass an estimate forward
- Pass an estimated line to a different calendar year
- Pass a committed line to an upcoming month
- Undo pass-to-upcoming-month
- Import from Excel / round-trip edit
- Charts, CSV, or catalog tables inside the Excel export
- Line-level savings flags, portfolio tracking, returns or market data (savings is a category flag only, C24)
- Applying the estimate check automatically, or linking a ticket to a specific estimated line
- Moving incomes or several tickets at once; undo of a move
- Undo / trash for a deleted month; deleting several months at once
- Storing a link between a month line and an annual

---

## 15. Test scenarios

1. Allowlist hit / miss (403, no leak).
2. Two users isolated.
3. Create Aug 2026 twice → second fails.
4. App does not create a month by itself.
5. Clone mortgage 800 committed + groceries 400 estimated + income 2000 → savings **800**.
6. Add grocery ticket 50, remaining untouched → savings **750**.
7. Set groceries remaining 350 → savings **800**.
8. Pass mortgage to actual → savings **800**; only in actuals.
9. Undo pass (unedited) → mortgage back in fixed.
10. Edit actual after pass → no undo.
11. Inactive category blocked on new ticket; old ticket visible.
12. Estimated line has no pass-to-actual.
13. Edit July in August → warning + persist.
14. Actual −20 increases savings by 20.
15. Hard-delete actual → gone from sums.
16. Soft-delete category → hidden from pickers; history intact.
17. One-off August reserved 30; create September from templates → September has no 30.
18. Change August grocery remaining to 100; create September → September grocery remaining is template 400, not 100.
19. Overspend: Food templates 400+50, actuals 500 → warning; month remaining ignored for that warning.
20. Annual “Home insurance” charge_month = 9, amount 250 → reminder in Sep 2026 and Sep 2027, not in Oct; amount visible when set.
21. Soft-delete that annual → no reminder; reactivate → reminder returns.
22. Quick-add from the reminder prefills name + category; no month line exists until the user confirms.
23. User B searching the same fragment as user A sees none of A’s tickets.
24. Query `cafe` matches a ticket named `Café Central`; a note-only match also returns; Spanish shell uses “Buscar”.
25. Hard-delete that ticket → it disappears from Search.
26. On August Actuals, type `ca` in the new-ticket name: suggestions include prefix matches from August, July, and June; a May ticket with the same prefix does not appear.
27. User B’s add-actual suggestions never include User A’s ticket names.
28. One character typed → no suggestion list. Picking a suggestion fills the name with the stored spelling; category and amount stay empty until the user sets them.
29. September Groceries estimated remaining 280; October already exists. Pass to upcoming → October: line gone from September Estimated; October Estimated has Groceries 280 as a month-only estimate.
30. September of the current year with no later month created: no Pass to upcoming month button. A previous-year month opened from History also has no button, even if later months of that year exist.
31. User B cannot pass User A’s estimated line, including by targeting User A’s October.
32. Alice exports All: one sheet per Alice month, newest first; Bob’s months are absent; Aug 2026 with income 2000, actual 50, reserved remaining 1200 → savings 750.
33. Year picker lists only years that have months, descending; **multiple years can be checked**. Export years 2026+2025 includes Alice’s 2026-08 and 2025-12 sheets.
34. Month picker lists owned months descending. Checking Aug 2026 and Dec 2025 yields those two sheets only; totals match the workspace summary.
35. Hard-delete template “Gym 40” → gone from Fixed expenses and from the next month's clone; a month created before the delete still has its Gym 40 line.
36. “Water 60” scheduled Jan/Mar/Jul/Oct + “Mortgage 800” unscheduled → creating Jan 2027 clones both; creating Feb 2027 clones Mortgage only.
37. Saving a schedule with all 12 months stores no schedule; saving zero months is rejected; duplicates are collapsed; month 13 is rejected.
38. Utilities “Water 60” scheduled {Jan} + “Power 50”: February actuals 70 → overspend warning (plan 50); January actuals 70 → no warning (plan 110).
39. User B cannot delete or reschedule User A's template.
40. Rescheduling or deleting a template does not change any existing month.
41. Income 3000; actuals Food 300; reserved Mortgage 800 (Housing); reserved Pension 500 (Investment, savings) → spending 1100, invested 500, left over 1400, total saved 1900; potential savings unchanged.
42. Flipping “Investment” to savings changes no stored amount and reclassifies every existing month on the next read; flipping back restores the old figures.
43. Investment template plan 500, actuals 600 → no overspend warning. The same numbers on a non-savings category → warning.
44. Global Stats: spend in normal categories 20 000 → 20 000, investments 3 000 → 6 000 → household cost change 0 %, invested series 3 000 → 6 000, savings rate rises, no savings-rate-drop insight.
45. Flagging an income category as savings is rejected.
46. User B cannot toggle User A's category; User B's flags never change User A's figures.
47. Groceries plan 400, remaining 400, tickets 120 → flagged, suggested 280; apply → remaining 280, savings +120.
48. Groceries 300 + Extra 100 (remaining 300 / 100), tickets 350 → suggested 50 → Extra (first by name) 50, Groceries 0.
49. Release all on a past month → every estimated line in the category is 0; committed lines and templates untouched.
50. Adding a ticket never changes any remaining by itself. A committed line passed to actual in a category with estimates → its ticket is listed, not counted; no flag.
51. User B cannot read or apply the estimate check on User A's month.
52. Nov 2026 ticket “Dentist 90” moved to Dec 2026 → gone from Nov, in Dec with the same id, category, name, note and amount; Nov savings +90, Dec savings −90.
53. From Feb 2027, Jan 2027, Dec 2026 and Nov 2026 are allowed targets (if created); Oct 2026 is rejected even when created.
54. From Nov 2026, Jan 2028 is allowed if created. A month that is not created never appears and cannot be targeted.
55. Moving to the same month is rejected. No target in the window → no move action on the ticket.
56. A pass-to-actual ticket that is moved loses its undo; no reserved line appears anywhere.
57. User B cannot move User A's ticket, nor move their own ticket into User A's month.
58. Delete Nov 2026 with 2 incomes, 5 lines, 7 actuals → all rows gone; other months untouched; Search no longer returns its tickets.
59. Re-create Nov 2026 after delete → succeeds and clones the current active templates for month-number 11.
60. A last-opened cookie pointing at the deleted month is cleared; Home shows the month list; no month is created.
61. User B cannot delete User A's month, and nothing of User A's is removed.
62. Annual “Car insurance” (Transport, charge_month 3); March has reserved “Car insurance 2026” in Transport → reminder shows Added, no quick-add.
63. The same name in a different category → not matched.
64. Annual “Seguro hogar” matches actual “SEGURO HOGAR mapfre” (accent/case folding).
65. Hard-deleting the matching line → the full reminder returns on the next render.

---

## 16. Implementation notes for agents

- Prefer explicit `kind`.
- Pass-to-actual and undo in **one transaction**.
- Never auto-balance envelopes.
- Overspend uses **active template amounts** (committed + estimated), not month remaining.
- Clone is a **snapshot write** at create; no live link to templates.
- Docker Compose: **app + PostgreSQL**.
- Keep domain words aligned with this glossary.

---

## 17. Closed questions

| Topic | Decision |
| --- | --- |
| Reports | Not V1; future yes. |
| Overspend | Confirmed: sum of estimated **template** amounts vs month actuals. Warn only. |
| Month vs template | Confirmed: clone **once** at create; each month is a separate instance. |
| Month-only extra reserved lines | Allowed; not written back to templates. |
| Unlimited actuals per month | Yes. |
| Undo after actual edit | Out of scope. |
| Missing current month | Do not create. List + create. Cookie resumes last opened if it exists. |
| Decimal input | `1234.56` only. |
| Deletes | Soft catalogs (including annuals); hard month money rows. |
| Cookie | Language + last opened month. |
| Annuals | Remind by month-number, any year. Never auto-create lines. |
| Search | Name or observations, sanitized `LIKE`, read-only. Explicit submit. Not the add-actual autocomplete. |
| Add-actual name autocomplete | This month + 2 prior months, name prefix, max 5, name only. |
| Pass estimated line to upcoming month | Current calendar year only. Later created months of that year. Estimated kind only. Never auto-create. No undo. Not History. |
| Template schedule & delete | Optional month-number schedule (absent = every month; all 12 = absent; never empty). Clone + overspend plan respect it. Hard delete allowed besides deactivate; existing months untouched. |
| Savings categories | Category flag, expense only. Reporting split only (spending vs invested); no overspend; retroactive reclassification; amounts never rewritten. |
| Estimate check | Own month tab. Suggests `max(plan − tickets, 0)`; flags a possible overlap only; fixes are explicit and confirmed; Release all on past months only. |
| Move actual | Any later created month or up to 3 calendar months back from the ticket's month. Row moves, never copies. No auto-create, no undo. |
| Delete month | Hard delete with cascade behind a typed label. Catalogs untouched; re-creating clones today's templates. |
| Annual reminder added | Read-time match: same category + folded name prefix. Collapses to Added; never dismissed; nothing stored. |
| Excel export | Home picker. All / one or more years with data / specific created months. One sheet per month. No charts. Tenant-scoped. |

No blocking product questions remain for V1 money behavior.

---

## 18. Suggested build order

1. Tenant user + allowlist + 403 + session  
2. Categories + profile currency + i18n cookie  
3. Templates with `kind` (soft-delete)  
4. Manual create month + **clone snapshot** + savings + month list  
5. Incomes + unlimited actuals (hard delete) + manual remaining  
6. Month-only extra reserved lines  
7. Pass-to-actual + undo-if-unedited  
8. Warnings (past month, overspend vs active templates)  
9. Last-month cookie + PWA install  
10. Annuals catalog + month-workspace reminders (never auto-create)  
11. Tests: isolation, clone snapshot, August must not leak into September  
12. Search actuals by name or notes (read-only)
13. Add-actual name autocomplete (this month + 2 prior, prefix)
14. Pass estimated line to a later created month of the current year
15. Excel export from Home (all / year / specific months) 
16. Template month schedule + hard delete (clone and overspend respect the schedule)
17. Savings categories (summary split, no overspend, Stats and export)
18. Estimate check tab
19. Move an actual expense to another month
20. Delete a month
21. Annual reminder “Added” state

---

## 19. Copy snippets (meaning, not final wording)

- Potential savings: “Income minus actual spend minus money still reserved in fixed/estimated lines.”
- Estimate help: “Tickets do not reduce this number. Decrease it yourself when you want the reserve to drop.”
- Pass to actual: “Move this commitment to actual spend. Estimates cannot be moved.”
- Past month: “This month is not the current calendar month. Changes are allowed.”
- 403: “This account is not allowed to use the app.”
- No month: “Create a month to start. Nothing is created automatically.”
- Overspend: “Actual tickets in this category are higher than the plan in your templates.”
- Clone: “Fixed and estimated lines are copied when the month is created. This month is independent after that.”
- Template schedule: “Only in some months. Leave it off for expenses charged every month.”
- Template delete confirm: “Delete this fixed expense permanently? Months you already created keep their copy.”
- Annual reminder: “Usually charged in {month}. Add an estimated/committed line manually if it applies this year.”
- Search idle: “Find a ticket from any year. Search matches the name or the note.”
- Search empty: “No tickets match that text. Try another word.”
- Actual name autocomplete list: “Recent names.”
- Pass to upcoming month: “Move this estimate to a later month you already created.”
- Export idle: “Download an Excel file with one sheet per month.”
- Export empty: “Create a month first. Nothing is exported until a month exists.”
- Savings category: “Money set aside (pension, index funds). It still leaves your available money, but it is not spending.”
- Left over: “Income minus spending minus money set aside for savings.”
- Estimate check flag: “Possible overlap: tickets in this category may already be covered by the reserve.”
- Move ticket: “Move this ticket to another month you already created.”
- Delete month confirm: “Delete {month} and everything in it? This cannot be undone. Type the month name to confirm.”
- Annual reminder added: “Added: {line name} · {amount}.”
