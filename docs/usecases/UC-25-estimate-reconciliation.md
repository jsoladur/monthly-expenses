# UC-25 — Estimate check (reconcile envelopes with tickets)

> **Database:** **no schema change.**
> **PRD refs:** proposed **UC-27** / **C25**; builds on §7.3 (estimates vs tickets), §7.4, §7.7, §19 "Estimate help". Screen 4 (PRD §10). Until merged into `docs/prds/GLOBAL.md`, **this file is the behavior source of truth**.
> **ARCH refs:** §5 (layering), §8 (integer cents).

## 0. Why this exists

PRD §7.3 step 4 names the main accuracy risk of the app: *"If they forget step 3, both the tickets and the remaining still hit savings."* Users who forget to lower an envelope see a savings figure that is too low, and past months keep the error forever. Nothing in the app helps them notice.

## 1. Goal

A per-month **Estimate check** that shows, per expense category with estimated lines, how much is still reserved against what was already spent, and offers **explicit** one-tap fixes. Never automatic (PRD §14 "Auto-reduce envelope when adding a ticket" stays a non-goal; §16 "Never auto-balance envelopes").

## 2. Out of scope

- Any automatic change to `remaining_amount`.
- Committed lines (they are passed to actual, not reconciled).
- Linking a ticket to a specific estimated line (no schema).

## 3. Rules

For the open month, per expense category that has at least one `kind = estimated` line:

```
plan       = Σ original_amount   of estimated lines in the category
remaining  = Σ remaining_amount  of estimated lines in the category
tickets    = Σ actual amounts    in the category
suggested  = max(plan − tickets, 0)      (per category)
```

- A category is **flagged** when `remaining > suggested` (money reserved that tickets already cover).
- **Actions** (per category, each one confirmed, one transaction):
  - **Set to plan − tickets** → distributes `suggested` across the category's estimated lines: lines are processed in `name` order; each line keeps `min(its remaining, what is left of suggested)`; later lines go to 0. A single-line category simply gets `suggested`.
  - **Release all** → every estimated line in the category goes to `remaining = 0` (offered on past months, when the envelope is finished).
- Lines are updated through the existing UC-09 `updateMonthLineRemaining` (same validation, tenancy, revalidate).
- Negative plans or tickets follow algebra (§7.6); `suggested` is clamped at 0, never negative.
- **Past months (§7.7):** if the month is before the current calendar month and any category is flagged, the month workspace shows a soft info banner "This month still reserves {amount} in estimates" with a link to the check. Not amber (that is overspend), not blocking, no dismissal.

## 4. Service (`src/server/services/estimate-check.ts`)

- `getEstimateCheck(userId, monthId)` → `{ categories: [{ categoryId, categoryName, plan, remaining, tickets, suggested, flagged, lines: [{ id, name, remaining }] }], releasableTotal }` in cents. `MonthNotFoundError` for other tenants.
- `applyEstimateSuggestion(userId, { monthId, categoryId, mode: 'suggested' | 'release' })` → recomputes inside one `db.transaction` (never trusts client numbers), updates the lines, returns the new summary.

## 5. Server actions (`src/actions/estimate-check.ts`)

- `applyEstimateSuggestionAction({ monthId, categoryId, mode })` → Zod → service → `revalidatePath('/[locale]/months/[year]/[month]', 'page')`.

## 6. UI

- Estimated tab header gets an **Estimate check** button showing a count badge of flagged categories (hidden when 0).
- Opens a bottom sheet (mobile) / dialog (desktop), same pattern as the Export drawer. One card per category: plan · spent · still reserved, a thin progress bar (spent vs plan, STYLE-GUIDE tokens), and the two actions. Confirmation copy states the new remaining before applying.
- Empty state: "Every estimate matches what you spent."

## 7. i18n keys

- `estimateCheck.{open, title, plan, spent, reserved, suggest, release, confirmSuggest, confirmRelease, empty}`
- `month.pastEstimatesBanner`

## 8. Acceptance criteria / tests (proposed PRD §15 #47–#51)

- #47 Groceries plan 400, remaining 400, tickets 120 → flagged, suggested 280; apply → remaining 280, savings +120.
- #48 Two lines Groceries 300 + Extra 100 (remaining 300 / 100), tickets 350 → suggested 50 → Extra (first by name) 50, Groceries 0.
- #49 Release on a past month → every estimated line in the category is 0; committed lines untouched; templates untouched.
- #50 Adding a ticket never changes any remaining by itself (regression for §7.2/§7.3).
- #51 Tenancy: user B cannot read or apply the check on user A's month (`MonthNotFoundError`).

## 9. Depends on / unlocks

- Depends on: UC-08, UC-09, UC-11.
- Unlocks: —
