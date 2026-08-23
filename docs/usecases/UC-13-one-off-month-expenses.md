# UC-13 — One-off month expenses (special occasions)

> **Database:** already migrated (UC-00). Uses `month_fixed_line` (`origin = 'month_only'`), `category` (expense). No schema changes.
> **PRD refs:** UC-18; §6.6 (`origin: cloned | month_only`); §7.8 (one-offs are not written back to templates; the next month's clone ignores them); §17 (closed question: month-only extra reserved lines are allowed).
> **ARCH refs:** §5 (layering).
> **Relationship to UC-09:** this slice REUSES the `addMonthOnlyLine` server action and service from UC-09 — there is NO new backend logic here. UC-13 specifies the dedicated user flow, the copy, and the end-to-end coverage for "special occasion" months.

## Goal

Make adding a one-off fixed/estimated expense to an already-created month an explicit, discoverable flow — for months with exceptional expenses (school books, an annual AMPA fee, a birthday) that must NOT propagate to future months.

## The reference flow (September 2026 example)

1. Create September 2026 (UC-06) → active templates are cloned once (mortgage as committed, groceries as estimated, …).
2. Add the month's income (UC-07). Actual expenses start at zero — nothing to do.
3. In the reserved-lines (fixed/estimated) section, use **Add one-off expense**: pick `kind` (`estimated` for school books / AMPA; `committed` for a one-off hard commitment), an ACTIVE expense category, a free-text name ("School books — Enzo"), and the amount.
4. The line appears in the month's reserved block with `origin = 'month_only'`, `remaining_amount = original_amount = amount`, and immediately reduces potential savings (UC-11).
5. When October 2026 is created later, it clones ONLY the templates — the school-books line is NOT there (PRD §7.8; test scenario #17).

## Server actions

- None new. Wire the UI to `addMonthOnlyLine({ monthId, categoryId, name, observations?, amount, kind })` from UC-09.

## Rules

- Category picker shows only ACTIVE expense categories (PRD §6.2).
- Amount may be negative (PRD §7.6); wire format `"1234.56"` (ARCH §8).
- A one-off line lives ONLY on its month instance; it is never written to `template` (PRD UC-18).
- A one-off line with `kind = 'committed'` CAN be passed to actuals (UC-10) — the undo snapshot (`converted_line_origin`) already preserves `month_only`, so undo restores it correctly.
- Hard delete behaves exactly like cloned lines (UC-09) and never touches templates.

## Routes / UI

- "Add one-off expense" affordance inside the reserved-lines block of the month workspace (screen 4), available for both kind groups.
- Explanatory copy, keyed (PRD §19 style): "This line exists only in this month. It is not saved to your templates and will not appear in future months."
- Visual badge on `month_only` lines so cloned and one-off lines are distinguishable at a glance.

## i18n keys

- `reservedLines.addOneOff.*`, `reservedLines.oneOffBadge`, `reservedLines.oneOffHelp`

## Acceptance criteria / tests

- E2E of the reference flow, mirroring PRD §15 #17: create Sep 2026 (mortgage template cloned) → add one-off estimated "School books — Enzo" 120.00 → potential savings drop by 120 → create Oct 2026 → October has NO school-books line.
- One-off `committed` line exposes pass-to-actual; one-off `estimated` line does not (PRD §7.5).
- Undo of a pass-to-actual on a one-off committed line restores it with `origin = 'month_only'`.
- Inactive expense categories are rejected by the picker.

## Depends on

- UC-09 (provides `addMonthOnlyLine`), UC-06 (month workspace). Recommended after UC-11 so the savings impact is visible in the summary header.
