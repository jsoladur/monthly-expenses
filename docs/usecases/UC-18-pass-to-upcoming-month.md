# UC-18 — Pass estimated line to an upcoming month

> **PRD status:** Merged at high level into `docs/prds/GLOBAL.md` as **UC-23** / C21. PRD **UC-18** remains month-only reserved lines. This file is the detailed implementation slice.
> **No schema change.** Reuse `month` and `month_fixed_line`. Do not add tables or columns.
> **PRD refs:** C1 / C6 / C7 / C15 / C21, §5.1 (tenancy), §6.6 (reserved lines), §7.2 (no double-count), §7.8 (months never sync; no auto-create), §11 (i18n).
> **ARCH refs:** §5 (thin action → service owns the transaction → repository SQL), §8 / ADR-5, ADR-6, ADR-9, ADR-10.
> **Visual:** `docs/styles/STYLE-GUIDE.md` wins for tokens. §7 of this file is the picker layout (mobile-first). Do not invent a second palette.

---

## 0. Why this exists (job-to-be-done)

An estimate is a reservation for **this** month. Sometimes the spend slips: the invoice lands in October, not September.

Today that means delete the September envelope, open October, recreate the same estimated line. Three screens for one intent:

> **Move this estimate to a later month I already created**, so the reservation leaves September and sits in October (or November) as an estimated line.

This is a **manual** move. It is not automatic rollover (C7 / C21). The target month must already exist (C6).

---

## 1. Goal

On the month workspace **Estimated** tab, each estimated card can offer **Pass to upcoming month** when (and only when) later months of the **current calendar year** already exist.

Success looks like: on a 360px phone in September 2026, with October and November already created, tap the new action → a bottom sheet lists October and November → pick November → the line disappears from September Estimated and appears on November Estimated as a month-only estimated line with the same remaining amount.

---

## 2. Out of scope (this slice)

Do **not** build:

- Passing **committed** lines (Actuals tab committed cards stay as they are).
- Passing to a **different calendar year** (January next year is not upcoming for this action).
- Passing from **History** (`?from=history`) or from any month whose year is not the current calendar year.
- Auto-creating the target month (C6).
- Automatic leftover rollover at month end (C7).
- Undo of this move. Escape hatch: delete the target line and add the estimate again on the source month.
- Passing actual tickets or incomes.
- Changing templates. The source `origin` (cloned vs month-only) is not written back to `template`.

---

## 3. Actors and jobs

| Actor | Job on this control |
| --- | --- |
| Allowlisted user | Move an estimate to a later created month of this year. |
| Visitor / blocked Google user | Never see the month workspace. |
| Coding agent | Cut-paste in one transaction. Never invent a month. |

---

## 4. Domain contract (normative)

### 4.1 Visibility (UI)

Show **Pass to upcoming month** on an estimated card **only** when all of these are true:

1. The open month’s **year equals the current calendar year** (`now.getFullYear()`).
2. The workspace was **not** opened from History (`from !== "history"`).
3. At least one **already created** month exists for the same user, **same year**, with `month > open month`.

Examples (today is any day in **2026**):

| Open month | Created months | Button |
| --- | --- | --- |
| Sep 2026 | Sep only | Hidden |
| Sep 2026 | Sep + Oct | Visible (picker: October) |
| Sep 2026 | Sep + Oct + Nov | Visible (picker: October, November) |
| Dec 2026 | Dec 2026 + Jan 2027 | Hidden (other year is not upcoming) |
| Sep 2025 | Sep + Oct 2025 | Hidden (not current year; History) |

### 4.2 What moves

**Source:** one `month_fixed_line` with `kind = estimated`.

**Target:** a `month` row the user already created.

In **one transaction**:

1. Insert a new `month_fixed_line` on the **target** month:
   - `category_id`, `name`, `observations` copied
   - `remaining_amount = source.remaining_amount`
   - `original_amount = source.remaining_amount` (insert-time amount on the target)
   - `kind = estimated`
   - `origin = month_only` (the target already has its own clone snapshot; this is a one-off on that instance)
2. HARD-delete the source line (C15 / §13).

After the move the money exists in **exactly one** reserved line (PRD §7.2). Source Estimated no longer lists it. Target Estimated does.

Savings: source month remaining drops (savings up); target remaining rises (savings down). Templates are untouched (PRD §7.8).

### 4.3 Server-side gates (must not trust the UI)

Reject before opening the transaction when:

| Condition | Error |
| --- | --- |
| Line missing / other tenant | `MonthLineNotFoundError` |
| `kind !== estimated` | `CommittedLineCannotPassToUpcomingError` |
| Source month year ≠ current calendar year | `NotCurrentYearError` |
| Target month missing / other tenant | `TargetMonthNotFoundError` |
| Target year ≠ source year, or target month ≤ source month | `TargetNotUpcomingError` |

`now` is injected (`Date`, default `new Date()`) so tests do not depend on the wall clock.

Never insert a `month` row from this slice.

### 4.4 Tenancy (P0)

Every read/write joins or filters `month.user_id = userId`. User B cannot move User A’s line or target User A’s October.

---

## 5. Layering

| Layer | Responsibility |
| --- | --- |
| Route `src/app/[locale]/months/[year]/[month]/page.tsx` | RSC. If `from === "history"` or year ≠ current year, pass `upcomingMonths = []`. Else call `listUpcomingMonthsForPass`. Pass the list into `EstimatedReservedLinesScreen`. |
| Service `listUpcomingMonthsForPass(userId, year, month, now?)` | Empty list when year ≠ current year; else later months of that year, ascending. |
| Service `passToUpcomingMonth(userId, { lineId, targetMonthId }, now?)` | Gates in §4.3; one `db.transaction` for insert + hard-delete. |
| Repository `listUpcomingMonthsInYear(userId, year, afterMonth)` | SQL only. `userId` first. `year = year AND month > afterMonth`. |
| Repositories `findMonthLineById`, `findMonthById`, `insertMonthLine`, `deleteMonthLine` | Existing. |
| Action `passToUpcomingMonthAction` | Zod → `requireUserId()` → service → revalidate **source and target** workspace paths. |
| Client picker | Bottom sheet. Confirm runs the action. |

Suggested DTOs (names may change; the fields may not):

```ts
type UpcomingMonthOption = {
  id: string;
  year: number;
  month: number; // 1–12
  label: string; // locale month name from the RSC
};

type PassToUpcomingMonthInput = {
  lineId: string;
  targetMonthId: string;
};
```

---

## 6. Routes / URL

No new route. Lives on `/[locale]/months/{year}/{month}` inside the Estimated tab. History entry (`?from=history`) never receives a non-empty `upcomingMonths` list.

---

## 7. Screen — first-mobile UI (normative)

**Subject:** household monthly envelopes. **Audience:** the same person who logs a month on a phone. **Single job:** pick a later created month and move this estimate there.

STYLE-GUIDE tokens only. No cream/serif, no acid-green-on-black, no broadsheet hairlines. No brand gradient on this control.

### 7.1 Design tokens (from STYLE-GUIDE §1 / §3)

| Role | Token | Hex |
| --- | --- | --- |
| Sheet surface | `--card` white | `#FFFFFF` |
| Selected month rail + check | `--estimated` teal | `#2AA198` |
| Selected row fill | `sky-tint` / `--secondary` | `#E8F4FD` |
| Confirm | `--primary` navy | `#1B3A6B` |
| Month label | `ink` / `--foreground` | `#0F1E33` |
| Focus ring | `--ring` blue | `#2E7DB2` |

Dark mode uses the existing token mapping. Do not add picker-only hex values.

**Type:** same face as the rest of the workspace (`text-sm` options, `text-base` title). No display size on month names.

**Signature (the one memorable thing):** a **forward-month list** — only later months of this year that already exist, chronological, teal rail on the selected row. Not a 12-month calendar grid and not a native `<select>`.

**Critique vs a generic picker:** a default dialog would offer every month or a date widget. This list is **short**, **already-created only**, and **same-year forward**. Empty months are absent so the user cannot invent October.

### 7.2 Mobile layout (360px base)

```
Estimated card
┌─────────────────────────────────┐
│ Groceries          280.00 €     │
│ Food · Cloned                   │
│  [edit] [to actual] [upcoming] [x] │
└─────────────────────────────────┘

Bottom sheet
┌─────────────────────────────────┐
│ ──                              │  grab
│ Pass to upcoming month          │
│ This estimate leaves this month │
│ and is reserved in the month    │
│ you pick.                       │
│                                 │
│ ○ October                       │  h-11, first preselected
│ ● November                      │  sky-tint + teal left rail
│                                 │
│ [ Cancel ]          [ Pass ]    │  44px
└─────────────────────────────────┘
```

- Reuse the existing `Drawer` (bottom sheet). `max-w-lg` already matches desktop.
- Each month option is a full-width button, min height **44px**, locale **month name** (year is implied).
- Nearest upcoming month is **preselected**. Confirm stays enabled.
- **No** amount, category, or “does not exist” placeholder rows.
- The row action is a fourth `IconButton` (calendar-forward icon) with the keyed label as its accessible name / tooltip. Hidden when `upcomingMonths.length === 0`.

### 7.3 Interaction

| Input | Result |
| --- | --- |
| Tap Pass to upcoming month | Open sheet; nearest later month selected. |
| Tap another month | Move selection. |
| Pass | Run the action; close on success; stay open with keyed error on failure. |
| Cancel / backdrop / Escape | Close; no write. |
| Empty upcoming list | Button not rendered. Do not open an empty sheet. |

### 7.4 Copy (keyed, both locales)

| Key | en | es |
| --- | --- | --- |
| `reservedLines.actions.passToUpcoming` | Pass to upcoming month | Pasar a un mes próximo |
| `reservedLines.actions.passToUpcomingHelp` | Move this estimate to a later month you already created. | Mueve esta estimación a un mes posterior que ya hayas creado. |
| `reservedLines.actions.passToUpcomingTitle` | Pass to upcoming month | Pasar a un mes próximo |
| `reservedLines.actions.passToUpcomingBody` | This estimate leaves this month and is reserved in the month you pick. | Esta estimación sale de este mes y queda reservada en el mes que elijas. |
| `reservedLines.actions.passToUpcomingConfirm` | Pass | Pasar |
| `reservedLines.actions.passToUpcomingMonthList` | Upcoming months | Meses próximos |
| `validation.committedLineCannotPassToUpcoming` | Only estimated lines can move to an upcoming month. | Solo las líneas estimadas pueden pasar a un mes próximo. |
| `validation.targetMonthNotFound` | That month no longer exists. Reload the page. | Ese mes ya no existe. Recarga la página. |
| `validation.targetNotUpcoming` | Pick a later month of this year that already exists. | Elige un mes posterior de este año que ya exista. |
| `validation.notCurrentYear` | This move is only available in the current year. | Este movimiento solo está disponible en el año actual. |

Reuse `reservedLines.actions.cancel`. Month names come from `monthName` / `monthYear` (PRD §11), never hardcoded.

### 7.5 Motion and a11y

- Sheet: `role="dialog"`, labelled by the title, described by the body.
- Month list: `role="radiogroup"` + `role="radio"` / `aria-checked`. Visible `focus-visible` ring (`--ring`).
- Selected state is teal rail **and** sky-tint, not color alone.
- `prefers-reduced-motion: reduce` → rely on the Drawer’s existing reduced motion. Do not add per-row stagger.
- Touch targets ≥ 44px on sheet options and Pass / Cancel.
- Icon button keeps `title` + tooltip like Edit / Pass to actual / Delete.

### 7.6 Desktop (`lg+`)

Same bottom sheet (`max-w-lg`). Do not switch to a floating select or a calendar grid.

---

## 8. i18n keys (namespaces)

All strings keyed in `en` + `es` (parity test).

- `reservedLines.actions.passToUpcoming`
- `reservedLines.actions.passToUpcomingHelp`
- `reservedLines.actions.passToUpcomingTitle`
- `reservedLines.actions.passToUpcomingBody`
- `reservedLines.actions.passToUpcomingConfirm`
- `reservedLines.actions.passToUpcomingMonthList`
- `validation.committedLineCannotPassToUpcoming`
- `validation.targetMonthNotFound`
- `validation.targetNotUpcoming`
- `validation.notCurrentYear`

---

## 9. Acceptance criteria / tests

Mapped PRD §15 scenarios: **#29, #30, #31**. Plus the slice tests below.

### 9.1 Unit (`isUpcomingMonthInSameYear`, `isPassToUpcomingAllowedYear`)

1. Same year, later month → true (`2026-09` → `2026-10`).
2. Same year, earlier or equal month → false.
3. Different year → false (`2026-09` → `2027-01`).
4. `isPassToUpcomingAllowedYear(2026, now=2026-09-12)` → true; year `2025` → false.

### 9.2 Integration (real Postgres)

5. Happy path: September estimated Groceries remaining `280.00` moves to October. Source line hard-deleted; target has `kind=estimated`, `origin=month_only`, remaining = original = `280.00`; observations copied (**#29**).
6. Templates untouched. October’s own cloned lines stay. User B cannot move User A’s line or target User A’s October (**#31**).
7. Committed line rejected (`CommittedLineCannotPassToUpcomingError`). Transaction never inserts.
8. Target in another year, target ≤ source month, missing target, missing line → rejected. No month row is created when the target is missing (C6).
9. Source year ≠ current year (`now` injected as 2026, source 2025) → `NotCurrentYearError`.
10. Negative remaining is copied (PRD §7.6).
11. Insert-then-delete is atomic: simulated delete failure rolls back; source line still present, target has no extra line.
12. `listUpcomingMonthsForPass` for Sep 2026 with Oct+Nov created returns Oct then Nov; Dec 2025 is absent; empty when `now` is 2025.

### 9.3 E2E (Playwright, chromium + mobile-safari)

13. Current year, September + October created: Estimated tab shows the button; picker lists October; Pass moves the line; October Estimated shows it; September does not (**#29**).
14. Current year, September only: button absent (**#30**).
15. Previous-year month opened with `?from=history` (later months in that year exist): button absent (**#30**).
16. Spanish: button accessible name is “Pasar a un mes próximo”; sheet title matches.

### 9.4 Visual / a11y / quality

17. Options are ≥ 44px. Focus ring visible. Sheet is labelled.
18. Typecheck + lint clean; i18n parity; no `userId`-less repository call.

---

## 10. Suggested files (implementation time)

| Path | Role |
| --- | --- |
| `src/lib/upcoming-months.ts` | `isUpcomingMonthInSameYear`, `isPassToUpcomingAllowedYear` |
| `src/server/repositories/month.ts` | `listUpcomingMonthsInYear` |
| `src/server/services/pass-to-upcoming.ts` | list + pass, domain errors |
| `src/actions/pass-to-upcoming.ts` | Zod action, revalidate both months |
| `src/app/[locale]/months/[year]/[month]/page.tsx` | RSC load + History/year gate |
| `src/app/[locale]/months/[year]/[month]/estimated-reserved-lines-screen.tsx` | Wire the fourth action |
| `src/components/pass-to-upcoming-month-drawer.tsx` | Bottom-sheet picker |
| `src/i18n/messages/{en,es}.json` | Keys in §8 |
| `tests/unit/upcoming-months.test.ts` | §9.1 |
| `tests/integration/pass-to-upcoming.test.ts` | §9.2 |
| `tests/e2e/pass-to-upcoming.spec.ts` | §9.3 |

---

## 11. Open decisions (defaults apply unless the Product Owner overrides)

| # | Topic | Default in this spec |
| --- | --- | --- |
| D1 | Undo this move | **Off** |
| D2 | Pass committed lines | **Off** |
| D3 | Cross-year target | **Off** |
| D4 | Preselect nearest upcoming month | **On** |
| D5 | Target `origin` | `month_only` |
| D6 | Target `original_amount` | Equal to remaining at move time |

---

## Depends on

- **UC-01** (auth / tenancy), **UC-02** (i18n), **UC-06** (months exist, never auto-created), **UC-09** (estimated lines + Estimated tab).
- Does **not** depend on UC-10 undo chrome, UC-14 annuals, UC-15 charts, UC-16 Search, or UC-17 autocomplete.
- **No schema change.**
