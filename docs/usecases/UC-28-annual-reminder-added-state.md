# UC-28 — Annual reminder "already added" state

> **Database:** **no schema change.** Nothing on a month row references an annual (§6.8); matching is computed at read time.
> **PRD refs:** proposed **UC-30** / **C28**; amends §7.9 presentation only. Screen 4 (PRD §10). Until merged into `docs/prds/GLOBAL.md`, **this file is the behavior source of truth**.
> **ARCH refs:** §5 (layering).

## 0. Why this exists

Annual reminders (UC-14) stay fully visible after the user has added the line, so the month workspace keeps nagging about something already handled. Dismissal is a §14 non-goal; this slice keeps the reminder but shows that it looks handled.

## 1. Goal

When the open month already contains a line that matches the annual, the reminder card collapses to a compact **Added** state and stops offering quick-add.

## 2. Out of scope

- Dismissing / hiding reminders (still a non-goal — the card never disappears).
- Storing a link between a line and an annual.
- Changing which reminders are shown (§7.9 unchanged).

## 3. Rules

An annual is **matched** in the open month when any `month_fixed_line` (committed or estimated) **or** `month_actual_expense` of that month has:

- the same `category_id` as the annual, **and**
- a folded name equal to, or starting with, the annual's folded name (same accent/case folding as UC-16/UC-17 — reuse that helper).

Matched → card shows "Added: {line name} · {amount}" with a check icon, quick-add hidden, a **Show details** toggle to expand the full card. Unmatched → unchanged UC-14 card.

## 4. Service (`src/server/services/annuals.ts`)

- `getAnnualReminders(userId, monthId)` additionally returns `match: { source: 'reserved' | 'actual', name, amount } | null` per reminder, computed from the month's rows (already tenant-scoped through the month). First match by reserved lines, then actuals, then name.

## 5. Server actions

- None (read-only).

## 6. UI

- `annual-reminder-cards.tsx`: compact matched variant (single row, muted info tokens, `CheckCircle2` icon), keyboard-accessible expand toggle with `aria-expanded`.

## 7. i18n keys

- `annuals.reminder.{added, showDetails, hideDetails}`

## 8. Acceptance criteria / tests (proposed PRD §15 #62–#65)

- #62 Annual "Car insurance" (Transport, charge_month 3); March has reserved "Car insurance 2026" in Transport → reminder shows Added, no quick-add.
- #63 Same name in a different category → not matched.
- #64 Accent/case folding: annual "Seguro hogar" matches actual "SEGURO HOGAR mapfre".
- #65 Hard-deleting the matching line → the full reminder returns on the next render.

## 9. Depends on / unlocks

- Depends on: UC-14, UC-16 (folding helper).
- Unlocks: —
