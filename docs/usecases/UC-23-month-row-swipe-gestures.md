# UC-23 — Swipe gestures on month rows

> **Status:** **DONE — shipped 2026-08-25** in 0.3.7 (commit `e64580f`), extended to income rows in 0.3.10. Retroactive slice written 2026-11-03 so the feature has a slice file; it documents existing behavior and asks for no new work.
> **Database:** **no schema change.** UI only; gestures call the existing server actions.
> **PRD refs:** none (not in PRD v1). Mobile-first month workspace (screen 4, PRD §10).
> **ARCH refs:** §5 (thin actions), STYLE-GUIDE touch targets.

## Goal

On a phone, the common row actions in the month workspace take one horizontal swipe instead of a tap on a small icon.

## Behavior

| Row | Swipe left (red, delete) | Swipe right (green) |
| --- | --- | --- |
| Income | Delete income | — |
| Actual expense | Delete actual | **Undo pass to actual**, only while the undo is allowed (§7.5) |
| Committed line | Delete line | **Pass to actual** |
| Estimated line | Delete line | **Pass to actual** |

- A swipe triggers after 30 px of horizontal travel. The direction locks after 8 px, so vertical scrolling is never hijacked (`touch-pan-y`). The row slides up to 80 px and reveals the action's icon and label, then snaps back.
- Deletes go through the same handler as the row's delete button, **including its `window.confirm`**. A swipe never deletes without confirmation.
- Rows without an allowed action in a direction don't move in that direction.
- The buttons on each row stay. Swipe is a shortcut, not the only way, so keyboard and mouse users lose nothing.

## Implementation (as shipped)

- `src/components/ui/swipe-action.tsx`: `SwipeAction` (`onSwipeLeft` / `onSwipeRight`, icons, labels), rendered as the row `<li>`.
- Used by `incomes-screen.tsx`, `actuals-screen.tsx` and `estimated-reserved-lines-screen.tsx`. The orphan `reserved-lines-screen.tsx` was removed in the same change; shared types moved to `reserved-lines-types.ts`.

## Acceptance criteria (as shipped)

- Swipe left on any month row asks for confirmation, then hard-deletes it (§13).
- Swipe right on a committed or estimated line passes it to actual. On an unedited converted actual it undoes the pass; on an edited one it does nothing.
- Vertical scrolling over rows still scrolls the page.

## Depends on / unlocks

- Depends on: UC-07, UC-08, UC-09, UC-10.
- Unlocks: UC-26 (move actual) should add its own row action only. A swipe direction is already taken on actual rows.
