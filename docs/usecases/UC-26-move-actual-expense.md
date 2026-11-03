# UC-26 — Move an actual expense to another month

> **Database:** **no schema change.** The move rewrites `month_actual_expense.month_id` in place.
> **PRD refs:** proposed **UC-28** / **C26**; builds on §6.7, §7.2 (no double-count), §7.5 (undo gate), §7.8 (no auto-create). Screen 4 (PRD §10). Until merged into `docs/prds/GLOBAL.md`, **this file is the behavior source of truth**.
> **ARCH refs:** §5 (thin action → service owns the transaction → repository SQL), §8 / ADR-5.
> **Sibling:** UC-18 moves **estimated reserved lines** forward within the current year. This slice moves **actual tickets** and has its own window (§3). The two do not share rules.
> **Replaces:** the earlier "Copy incomes from the previous month" draft, first numbered UC-23 (PO decision 2026-11-03).

---

## 0. Why this exists

A ticket recorded in the open month sometimes belongs elsewhere in the household's books:

- **Forward:** the charge really falls into next month's budget (paid late, or deliberately deferred).
- **Backward:** the previous month still had room ("bandwidth"), so the user decides to book the ticket there.

Today the user must hard-delete the ticket, open the other month and re-enter it. This slice makes it one deliberate action.

## 1. Goal

From the month workspace **Actuals** tab, each actual expense offers **Move to another month**. A picker lists every allowed target month that already exists; picking one moves the ticket there. It leaves this month's totals and appears in the target's.

## 2. Out of scope

- Auto-creating a target month (C6). Missing months simply don't appear in the picker.
- Moving incomes or reserved lines (reserved lines forward are UC-18).
- Moving several tickets at once.
- Undo. To reverse the move, the user moves the ticket back, which the window allows for a move of up to 3 months.
- Copying (the ticket is never in two months — §7.2).

## 3. Rules

Let **S** be the source month of the ticket (year·month), compared as `index = year * 12 + (month − 1)`.

**Allowed target T** — a month the signed-in user **already created**, `T ≠ S`, and either:

- **Upcoming:** `index(T) > index(S)`. **Any** later created month, across years (Dec 2026 → Jan 2027 is fine). No upper bound.
- **Previous, max 3 back:** `index(S) − 3 ≤ index(T) < index(S)`. Calendar distance, across years (Feb 2027 → Nov 2026 is fine; Feb 2027 → Oct 2026 is not).

Other rules:

- The window is relative to the **ticket's month**, not to today. A month opened from History offers the same window around itself.
- The move keeps the row: same `id`, category, name, observations, amount, `created_at`. Only `month_id` and `updated_at` change. One transaction, tenant-checked on both months.
- The category may be inactive now. A move does not create a ticket, so the "active at creation" rule (§6.7) does not apply.
- **Pass-to-actual tickets** (`converted_from_line_id IS NOT NULL`): moving counts as an edit, so it sets `edited_after_conversion = true` and the undo is no longer offered (§7.5). Undo would otherwise re-insert the reserved line into the wrong month.
- Overspend (§7.4) and the summary (§7.1) of both months recompute on the next read. A move can trigger an overspend warning on the target. That is a warning only and never blocks.
- No target allowed → the action is hidden (not disabled) for that ticket.

## 4. Service (`src/server/services/move-actual.ts`)

- `listMoveTargets(userId, monthId)` → `{ previous: MonthKey[] /* newest first, ≤ 3 */, upcoming: MonthKey[] /* oldest first */ }`. `MonthNotFoundError` for another tenant's month.
- `moveActualToMonth(userId, { actualId, targetMonthId })` → loads the actual through its month (`month.user_id = userId`; otherwise `ActualNotFoundError`), loads the target (`MonthNotFoundError`), and enforces the window (`MoveTargetOutOfWindowError`, which also covers `T = S`). It updates inside `db.transaction` and returns `{ from: MonthKey, to: MonthKey }`.
- Pure helper `isMoveTargetAllowed(source: MonthKey, target: MonthKey): boolean` in `src/lib/move-window.ts` (unit-tested; shared by the picker and the service).
- Repository (`actual.ts`): `moveActual(userId, actualId, targetMonthId, tx)`, an `UPDATE … FROM month` guarded by `user_id` on both months. Month list for targets comes from `listMonths(userId)` (`month.ts`).

## 5. Server actions (`src/actions/actuals.ts`)

- `moveActualAction({ actualId, targetMonthId })` → Zod (`uuid`, `uuid`) → service → `revalidatePath` for the source and target month pages, plus Search and Stats.
- Error codes: `"moveTargetOutOfWindow"`, `"monthNotFound"`, `"actualNotFound"`.

## 6. UI

- Actual card / row overflow (same place as Edit and Delete) → **Move to another month** (lucide `CalendarArrowUp` or `ArrowLeftRight`), shown only when `listMoveTargets` has at least one entry. Targets are computed once per page in the RSC, not per row.
- Bottom sheet (mobile) / dialog (desktop), same pattern as UC-18's picker: a header showing the ticket (name · amount), then two groups:
  - **Earlier months**: up to 3 rows, newest first.
  - **Later months**: oldest first, scrolling if long.
  - Each row: locale month name + year, and that month's current left-over figure as context for "is there room?" (read from the same summary service, muted text).
- Picking a row → confirm button "Move to {month} {year}" → toast "Moved to {month} {year}" with a link to open that month. The ticket leaves the list immediately.
- On pass-to-actual tickets the sheet notes: "Undo from fixed expenses will no longer be available."

## 7. i18n keys

- `actuals.move.{action, title, earlier, later, leftOver, confirm, done, openTarget, undoLostNote}`
- `validation.moveTargetOutOfWindow`

## 8. Acceptance criteria / tests (proposed PRD §15 #52–#57)

- #52 Nov 2026 ticket "Dentist 90" moved to Dec 2026 → absent from Nov actuals and totals, present in Dec with the same id, category, name, note and amount; Nov savings +90, Dec savings −90.
- #53 Window backward: from Feb 2027, targets Jan 2027, Dec 2026 and Nov 2026 are allowed (if created); Oct 2026 is rejected (`MoveTargetOutOfWindowError`) even when created.
- #54 Window forward: from Nov 2026, Jan 2028 is allowed if created. A month that is not created never appears and cannot be targeted.
- #55 Moving to the same month → rejected. No target in the window → no action on the card.
- #56 Pass-to-actual ticket moved → `edited_after_conversion = true`, no undo offered on the target; no reserved line appears anywhere.
- #57 Tenancy: user B cannot move user A's ticket, nor move their own ticket into user A's month (`ActualNotFoundError` / `MonthNotFoundError`).

## 9. Depends on / unlocks

- Depends on: UC-06, UC-08, UC-10 (undo gate), UC-11, UC-23 (row actions; both swipe directions on actual rows are taken, so Move is a row action, not a swipe).
- Unlocks: —
