# Monthly Expenses — Product Requirements (AI-agent optimized)

> **Audience:** coding agents and humans implementing the product.  
> **Status:** MVP specification — money rules confirmed.  
> **Scope rule:** describe *what* the product must do. Do not invent UI libraries, frameworks, or cloud vendors beyond constraints already decided by the Product Owner.  
> **Public URL:** https://expenses.jmsola.dev

---

## 1. Mission

A personal Progressive Web App where an allowlisted user tracks **one calendar month at a time**: incomes, reusable categories, **fixed** commitments, **estimated** envelopes, and **actual** tickets. From day one of a new month, committed/estimated money is already reserved so **potential savings** is visible immediately.

**Primary job-to-be-done:** open a month, see remaining savings, add a real expense in a few taps, optionally reduce an estimate by hand.

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
| C13 | Expense **name** is free text. Autocomplete is **not** MVP. |
| C14 | Attachments, merchant, payment method = **future**, not MVP. |
| C15 | **Hard delete** for month-scoped money rows (incomes, actual expenses, month fixed/estimated lines). |
| C16 | Reports (year view, category totals) = **not V1**, planned later. |
| C17 | At **create month**, active fixed + estimated **templates are cloned** into that month instance. After that, the month lives on its own. |
| C18 | Overspend warning: actuals in a category vs **sum of estimated template amounts** in that category. Warn only, never block. |

---

## 3. Actors

| Actor | Meaning |
| --- | --- |
| Visitor | Not signed in. Can only start Google sign-in. |
| Blocked Google user | Authenticated with Google, email not on allowlist. Sees 403 only. |
| User | Allowlisted. Owns categories, months, incomes, fixed/estimated lines, actuals, profile settings. |
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
| **Plan amount (overspend baseline)** | Sum of **estimated** amounts on the **template form** for that category. Not the remaining box in the month. |
| **Potential savings** | See §7. |
| **Pass to actual** | One-tap **cut and paste**: remove committed fixed line from the month’s fixed block; create an equivalent actual row. Undo = reverse **only while the actual was not edited**. |
| **Logical erase** | Soft-delete / deactivate catalogs (categories, templates). Hidden from new pickers. History keeps the id. |
| **Hard delete** | Row removed. Used for month incomes, month actuals, month fixed lines. |

---

## 5. Multi-tenancy and identity

### 5.1 Isolation invariant

Every query/mutation for months, categories, incomes, expenses, templates, and settings **must** be scoped to `user_id` of the session. No user can read or write another user’s rows. Agents: treat missing `user_id` filter as a **P0 bug**.

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

**Soft-delete / deactivate:** cannot be chosen for **new** actuals, incomes, or new template lines. Existing month rows still display the name. Reactivate allowed.

### 6.3 Fixed/Estimated template (per user, global management form)

| Field | Rules |
| --- | --- |
| expense_category | Mandatory |
| name | Mandatory, free text |
| observations | Optional |
| amount | Mandatory, 2 decimals, **may be negative** |
| kind | `committed` **or** `estimated` |
| active | Soft-delete; inactive templates are **not** cloned into **new** months |

Clone source only. Never updated from month edits.

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
| name | Mandatory |
| observations | Optional, may be empty |
| amount | Mandatory, 2 decimals, may be negative |

**Hard delete.** Unlimited actuals per month. Never cloned.

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

### 7.2 No double-count

- A line lives in **either** `MonthFixedLine` **or** `MonthActualExpense`, never both.
- **Pass to actual** moves the row (cut-paste). After move, it is **only** in actuals.
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
- **Right:** `SUM(active estimated template amounts)` in that same category.  
  Example: templates “Groceries 400” + “Extra 50” in Food → plan = **450**. Actuals 500 → **warning**.

If a category has **only committed** templates and no estimated templates, **no** estimate-overspend warning for that category.

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
- Clone happens **once**, at create time, from **active** fixed + estimated templates.
- After create, August and September never sync to each other or back to templates.
- User may add **any number of actual expenses** on a month.
- User may add or hard-delete reserved lines **only on that month** (one-offs). They are not written to the template and will not appear in the next month unless added to the template before that month is created.
- Changing or soft-deleting a template does **not** rewrite months that already exist.
- Unused remaining in August does **not** roll into September.

**Incomes are not cloned** (not MVP).

---

## 8. Month lifecycle

```
[User has templates + categories]
        │
        ▼
[User creates Month(year, month)] ── if exists ──► error
        │                    never auto-created
        ▼
Clone ALL active fixed/estimated templates → MonthFixedLine
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

- Catalog of reserved lines: category, name, amount, `kind`. Soft-delete → not cloned later; existing months unchanged.

### UC-08 — Create calendar month

- User picks month + year.
- Duplicate rejected.
- Active templates cloned **once** into the new instance.
- Nothing created automatically.

### UC-09 — Add income

- Category, name, amount required. Hard delete. Not cloned.

### UC-10 — Add actual expense

- Category, name, amount required. Observations optional.
- Unlimited tickets. Does not change remainings. Hard delete.

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

---

## 10. Screens (logical)

1. Sign-in  
2. 403  
3. Month list / empty + create month  
4. Month workspace — summary + incomes + reserved lines + actuals  
5. Expense categories  
6. Income categories  
7. Fixed/estimated templates  
8. Profile settings — currency  
9. Language switcher  
10. Install PWA — if not installed  

Mobile-first: add an actual from the month workspace.

---

## 11. i18n

- All user-facing strings keyed. Locales `en`, `es`.
- Month names follow locale.
- Amount input: `1234.56` in both locales.
- Translate 403, validation, past-month warning, overspend warning.

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
| Templates (fixed/estimated catalog) | Soft |
| Other catalog/settings CRUDs | Soft |
| Month incomes | Hard |
| Month actual expenses | Hard |
| Month fixed/estimated lines | Hard |
| Month header | Not required in V1; if later, cascade hard-delete children |

---

## 14. Explicit non-goals (V1)

- Household / shared months
- Admin UI for allowlist
- Offline-first sync
- Name autocomplete
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
- Export/backup UI
- Income templates / cloning incomes

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

---

## 16. Implementation notes for agents

- Prefer explicit `kind`.
- Pass-to-actual and undo in **one transaction**.
- Never auto-balance envelopes.
- Overspend uses **active estimated template amounts**, not month remaining.
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
| Deletes | Soft catalogs; hard month money rows. |
| Cookie | Language + last opened month. |

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
8. Warnings (past month, overspend vs estimated templates)  
9. Last-month cookie + PWA install  
10. Tests: isolation, clone snapshot, August must not leak into September  

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
