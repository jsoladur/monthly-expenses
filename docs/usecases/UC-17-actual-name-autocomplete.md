# UC-17 — Actual name autocomplete (add-ticket form)

> **PRD status:** Merged at high level into `docs/prds/GLOBAL.md` as **UC-22** / C13 (updated). This file is the detailed implementation slice.
> **No schema change.** Query existing `month_actual_expense` rows joined to `month`. Do not add tables, columns, extensions, or generated search columns.
> **PRD refs:** C1 / C9 / C13 / C20, §5.1 (tenancy), §6.7 (actual tickets), §11 (i18n), UC-10 (add actual), UC-21 (Search is a different surface).
> **ARCH refs:** §5 (RSC reads — this slice has **no mutations**), §8 / ADR-5, ADR-6, ADR-9, ADR-10.
> **Visual:** `docs/styles/STYLE-GUIDE.md` wins for tokens. §8 of this file is the add-form autocomplete layout (mobile-first). Do not invent a second palette.

---

## 0. Why this exists (job-to-be-done)

The primary job on the Actuals tab is still **record this ticket in a few taps** (PRD §1). After a few months of tickets, the same merchant names come back: bread, pharmacy, the weekly shop.

> **Reuse a name I already typed recently**, so I do not retype it with one thumb and the keyboard open.

This is **not** Search (UC-16 / PRD UC-21). Search finds tickets across years by name **or** note, on a dedicated page, after an explicit submit. Autocomplete only fills the **name** field on the **add-actual** form, from a **three-month window**, by **prefix**.

---

## 1. Goal

On the month workspace Actuals tab, the add-ticket name input (`#new-actual-name`) offers a short list of recent names once the user has typed **at least two characters**.

Success looks like: on a 360px phone with the keyboard open, type `ca` → up to **five** tappable recent names appear **directly under the field**; tap one → the input shows the stored spelling; category, observations, and amount stay untouched; Add still creates the ticket the existing UC-08 way.

---

## 2. Out of scope (this slice)

Do **not** build:

- Autocomplete on the **edit**-ticket name field (only `#new-actual-name`).
- Autocomplete of incomes, reserved lines, templates, annuals, or categories.
- Filling category, amount, or observations when a name is picked.
- Matching on **observations** (name prefix only).
- Contains / fuzzy / tokenized match (prefix only).
- Search-page live typeahead (UC-16 stays explicit submit — C20).
- Saved recent queries, merchant catalog, or a new table of aliases.
- Full-text search, `pg_trgm`, `unaccent`, or extra columns.
- Highlighting the matched prefix inside the suggestion (keep the row quiet).

---

## 3. Actors and jobs

| Actor | Job on this control |
| --- | --- |
| Allowlisted user | Type two letters, pick a recent name (or ignore the list and keep typing). |
| Visitor / blocked Google user | Never see the month workspace. |
| Coding agent | Implement this spec; do not scan all tickets in the client. The corpus is the three-month window, loaded in the RSC. |

---

## 4. Query contract (normative)

### 4.1 Window

From the **open month** `(year, month)`, include tickets whose parent month is one of:

1. The open month.
2. One calendar month earlier.
3. Two calendar months earlier.

Example: open **August 2026** → August 2026, July 2026, June 2026. Open **January 2026** → January 2026, December 2025, November 2025.

Months that were **never created** contribute nothing (C6 — never auto-create). Tickets older than two months back never appear, even if the name would match.

### 4.2 What is matched

**Table:** `month_actual_expense` only.

**Column:** `name` only.

**Match:** folded name **starts with** the folded query (prefix). Not `LIKE '%term%'`.

**Not matched:** observations, category name, amount.

### 4.3 Fold (same as Search)

Reuse `foldAccents` / the SQL `translate` alphabet from `src/server/search/sanitize.ts`.

| Step | Rule |
| --- | --- |
| 1. Unicode fold | NFD, strip combining marks (`é` → `e`, `ñ` → `n`). |
| 2. Case | Lowercase. |
| 3. Minimum | Fewer than **2** folded characters → **no list** (do not treat as “no matches”; the list is simply closed). |
| 4. Prefix | Folded stored name `startsWith` folded query. |

`Café Central` matches query `ca` / `CA` / `cá`. It does **not** match `central` (not a prefix).

### 4.4 Uniqueness and order

Each **folded** name appears **once**. Keep the spelling and `(year, month)` of the **most recently created** ticket with that folded name.

Order the corpus **most recently used first**. After the prefix filter, take the first **5**. Recency beats alphabetical order: the name I logged yesterday should sit above a match from two months ago.

### 4.5 Tenancy (P0)

`month_actual_expense` has no `user_id`. Every read **joins** `month` and filters `month.user_id = userId`. User B never sees User A’s names.

Hard-deleted tickets are absent (PRD C15). Incomes and reserved lines with the same name are **not** returned.

### 4.6 Caps

| Cap | Value | Why |
| --- | --- | --- |
| Suggestion list | **5** | 44px rows × 5 = 220px. Fits under the name field on a 360px phone without covering Amount + Add. User range was 3–7; 5 is the mobile default. |
| Corpus from SQL | **200** unique names | Safety valve for the RSC payload. Household 3-month windows stay well under this. |
| Name length | 80 | Same as ticket `name`. |

Exact folded match of the current input is **omitted** from the list (the user already typed the name).

---

## 5. Layering

Reads stay in the RSC (ARCH §5 rule 3). **Do not** add a mutation-shaped server action for this lookup.

| Layer | Responsibility |
| --- | --- |
| Route `src/app/[locale]/months/[year]/[month]/page.tsx` | RSC. After `requireUserId()`, call the service with the open `(year, month)`. Pass the corpus into `ActualsScreen`. |
| Service `listRecentActualNameSuggestions(userId, year, month)` | Build the 3-period window; call the repository; return `{ name, year, month }[]`. |
| Repository `listRecentActualNames(userId, periods)` | SQL only. `userId` first. Rows in the 3-month window, newest `created_at` first (`LIMIT 1000`). Unique on folded name in the repository (newest spelling wins), cap **200**. |
| Pure helper `filterNameSuggestions(corpus, rawQuery, limit=5)` | Client-side prefix filter + exact-match omit. Unit-tested. Used by the combobox; **not** a second SQL trip. |
| Client `#new-actual-name` | Combobox. Opens at 2 folded chars. Selecting a row writes the **stored** `name` into the input. |

Suggested DTO (names may change; the fields may not):

```ts
type ActualNameSuggestion = {
  name: string;
  year: number;
  month: number; // 1–12 of the most recent ticket with this folded name
};
```

No amounts, no category ids, no observations on this DTO.

Matching the **window** in SQL (not in the client) is mandatory. Unique-on-folded-name is applied in the repository after `ORDER BY created_at DESC` (not `DISTINCT ON`, whose expressions cannot be parameterized twice). Prefix-filtering a 200-name corpus in the client is accepted so suggestions appear on the same keystroke as the second character (first-mobile: no debounce, no radio round-trip while the keyboard is open).

---

## 6. Routes / URL

No new route. Lives on `/[locale]/months/{year}/{month}` inside the Actuals tab add form. Nothing is written to the query string.

---

## 7. Screen — first-mobile UI (normative)

**Subject:** household ticket capture. **Audience:** the same person who logs spend on a phone in a minute. **Single job:** type two letters → pick a name already used this quarter.

STYLE-GUIDE tokens only. No cream/serif, no acid-green-on-black, no broadsheet hairlines. No brand gradient on this control.

### 7.1 Design tokens (from STYLE-GUIDE §1 / §3)

| Role | Token | Hex |
| --- | --- | --- |
| Input + list surface | `--card` white | `#FFFFFF` |
| Active / keyboard-focus row | `sky-tint` / `--secondary` | `#E8F4FD` |
| Suggestion name | `ink` / `--foreground` | `#0F1E33` |
| Focus ring | `--ring` blue | `#2E7DB2` |

Dark mode uses the existing `--card` / `--secondary` / `--foreground` mapping. Do not add autocomplete-only hex values.

**Type:** same face as the rest of the add form (`text-sm`). No display size on suggestions.

**Signature (the one memorable thing):** an **inline prefix list** that appears the instant the second letter is typed, docked under `#new-actual-name`, sky-tint on the active row, original stored spelling. Everything around it stays the existing add form.

**Critique vs a generic combobox:** a default widget would float, fuzzy-match all history, show a search icon and a “no results” row. This list is **inline** (stays attached above the keyboard), **prefix-only**, **three months**, and **silent when empty**.

### 7.2 Mobile layout (360px base)

```
┌─────────────────────────────┐
│ [ category select       ▾ ] │  unchanged
│ [ ca                      ] │  #new-actual-name  h-9 / grow to 44px tap
│ ┌─────────────────────────┐ │
│ │ Café Central            │ │  sky-tint when active, h-11 (44px)
│ │ Carrefour               │ │
│ │ Card fee                │ │  max 5 rows, no scrollbar unless >5
│ └─────────────────────────┘ │  1px --border, radius --radius
│ [ observations            ] │  unchanged
│ [ 1234.56 ]        [ Add ]  │  unchanged
└─────────────────────────────┘
```

- The list is **in flow** under the name field, not a `fixed`/`absolute` overlay. Overlay positioning fights the mobile keyboard; an in-flow list does not.
- Each option is a full-width button, min height **44px**, `px-3`, left-aligned, truncated with `truncate`.
- **No** month caption, amount, or category on the row (Chanel: one accessory removed). Recency is the sort, not a label.
- **No** “no matches” empty state. If the filter is empty, the list is not rendered.
- **No** FAB, no search icon inside the input.
- Native `<datalist>` is forbidden (inconsistent iOS, cannot meet 44px / sky-tint).

### 7.3 Interaction

| Input | Result |
| --- | --- |
| 0–1 folded characters | List closed. |
| ≥2 folded characters, matches | List open; first option is **not** auto-selected (typing continues). |
| ArrowDown / ArrowUp | Move `aria-activedescendant` among options. |
| Enter while an option is active | Fill the name; close the list; **do not** submit the form. |
| Enter with no active option | Existing form submit (UC-08). |
| Escape | Close the list; keep the typed text. |
| Tap / click an option | Fill the stored name; close; focus stays in the input. |
| Blur (tap outside) | Close. `mousedown` on an option `preventDefault` so blur does not beat the click. |
| Pick a name | Category, observations, amount **unchanged**. |

After a successful Add, the existing `formKey` remount resets the input and the list.

### 7.4 Copy (keyed, both locales)

| Key | en | es |
| --- | --- | --- |
| `actuals.autocomplete.listLabel` | Recent names | Nombres recientes |
| `actuals.autocomplete.a11y.suggestions` | {count, plural, one {# recent name} other {# recent names}} | {count, plural, one {# nombre reciente} other {# nombres recientes}} |

Do not add idle/empty copy. The closed list is the idle state.

### 7.5 Motion and a11y

- Input: `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`, `aria-controls` → listbox id, `aria-activedescendant` when an option is active. Keep `id="new-actual-name"`.
- List: `role="listbox"`, `aria-label` from `actuals.autocomplete.listLabel`. Options: `role="option"`, `aria-selected`.
- `aria-live="polite"` on a visually hidden count using `actuals.autocomplete.a11y.suggestions` when the list opens or the count changes.
- Visible `focus-visible` ring on the input (`--ring`). Active option uses sky-tint, not color alone (`aria-selected`).
- `prefers-reduced-motion: reduce` → no list entrance animation. Default: no animation either (the list simply appears). Do not add per-row stagger.
- Contrast: ink-on-white and navy-on-sky-tint already verified in STYLE-GUIDE §6.
- Touch targets ≥ 44px.

### 7.6 Desktop (`lg+`)

Same inline list, same 5-row cap. Do not switch to a floating popover or a two-column “preview”.

---

## 8. i18n keys (namespaces)

All strings keyed in `en` + `es` (parity test).

- `actuals.autocomplete.listLabel`
- `actuals.autocomplete.a11y.suggestions`

Reuse `actuals.name` / `actuals.actions.placeholder` for the input. Month names are not shown.

---

## 9. Acceptance criteria / tests

Mapped PRD §15 scenarios: **#26, #27, #28**. Plus the slice tests below.

### 9.1 Unit (`recentMonthWindow`, `filterNameSuggestions`)

1. `recentMonthWindow(2026, 8)` → `(2026,8), (2026,7), (2026,6)`.
2. `recentMonthWindow(2026, 1)` → `(2026,1), (2025,12), (2025,11)`.
3. Query `"ca"` matches `"Café Central"` and `"Carrefour"`, not `"Pan"`.
4. Query `"central"` does **not** match `"Café Central"` (not a prefix).
5. Query `"a"` → `[]` (too short).
6. Query `"café"` with corpus `["Café"]` → `[]` (exact folded match omitted).
7. More than 5 prefix matches → first 5 in corpus order (recency), never 6.

### 9.2 Integration (real Postgres)

8. Every name SQL includes `month.user_id = userId`. User B’s corpus contains **none** of User A’s names (PRD §15 **#27**).
9. Open August: a June ticket named `"Café Central"` is in the corpus; a May ticket is **not** (**#26**).
10. Duplicate folded names (`"Café"` in July, `"cafe"` in August) → one row, August spelling (newest `created_at`).
11. Incomes and reserved lines with the same name are **not** in the corpus.
12. Hard-deleted actual disappears from the corpus (PRD C15).
13. Missing July/June months: August-only tickets still return; no month is created.

### 9.3 E2E (Playwright, chromium + mobile-safari)

14. Open August Actuals, seed June `"Café Central"` + July `"Carrefour"` + May `"Pharmacy"`. Type `ca` in `#new-actual-name` → list shows Café Central and Carrefour; Pharmacy is absent (**#26**).
15. Tap Café Central → input value is `Café Central`; category/amount unchanged; Add still creates the ticket (**#28**).
16. Type a single letter → no listbox (**#28**).
17. Spanish: list `aria-label` is “Nombres recientes”.
18. Existing add → edit → delete happy path from UC-08 still works with `#new-actual-name`.

### 9.4 Visual / a11y / quality

19. Options are ≥ 44px. Focus ring visible. List is announced.
20. Typecheck + lint clean; i18n parity; no `userId`-less repository call.

---

## 10. Suggested files (implementation time)

| Path | Role |
| --- | --- |
| `src/lib/actual-name-suggestions.ts` | `recentMonthWindow`, `filterNameSuggestions`, caps |
| `src/server/repositories/actual.ts` | `listRecentActualNames` |
| `src/server/services/actuals.ts` | `listRecentActualNameSuggestions` |
| `src/app/[locale]/months/[year]/[month]/page.tsx` | RSC load + pass corpus |
| `src/app/[locale]/months/[year]/[month]/actuals-screen.tsx` | Wire the combobox into the add form |
| `src/components/actual-name-autocomplete.tsx` | Combobox client island |
| `src/i18n/messages/{en,es}.json` | Keys in §8 |
| `tests/unit/actual-name-suggestions.test.ts` | §9.1 |
| `tests/integration/actual-name-suggestions.test.ts` | §9.2 |
| `tests/e2e/actual-name-autocomplete.spec.ts` | §9.3 |

---

## 11. Open decisions (defaults apply unless the Product Owner overrides)

| # | Topic | Default in this spec |
| --- | --- | --- |
| D1 | Autocomplete on edit-ticket name | **Off** |
| D2 | Fill category / amount on select | **Off** |
| D3 | Debounced SQL as the user types | **Off** — RSC corpus + client prefix filter |
| D4 | Match observations | **Off** |
| D5 | Visible month caption on each row | **Off** |
| D6 | List length | **5** |

---

## Depends on

- **UC-01** (auth / tenancy), **UC-02** (i18n), **UC-06** (months exist), **UC-08** (actual tickets + add form).
- Does **not** depend on UC-09 remaining edits, UC-10 undo chrome, UC-14 annuals, UC-15 charts, or UC-16 Search UI.
- **No schema change.**
