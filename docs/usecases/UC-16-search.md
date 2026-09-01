# UC-16 — Search (find actual expenses across years)

> **PRD status:** Merged at high level into `docs/prds/GLOBAL.md` as **UC-21** / C20 / §10 screen 12. PRD **UC-16** remains negative amounts. This file is the detailed implementation slice.
> **No schema change.** Query existing `month_actual_expense` rows joined to `month` and `category`. Do not add tables, columns, extensions (`unaccent`, `pg_trgm`), or generated search columns.
> **PRD refs:** C1 / C9 / C13 / C20, §5.1 (tenancy), §6.2 (inactive category names still show), §6.7 (actual tickets), §11 (i18n), UC-10 (actuals are tickets).
> **ARCH refs:** §5 (RSC reads — this slice has **no mutations**), §8 / ADR-5 (integer cents on the wire to the UI), ADR-6, ADR-9, ADR-10.
> **Visual:** `docs/styles/STYLE-GUIDE.md` wins for tokens. §8 of this file is the Search-page layout (mobile-first). Do not invent a second palette.

---

## 0. Why this exists (job-to-be-done)

The app’s primary job is still **one calendar month at a time** (PRD §1). After years of tickets, a second job appears:

> **Find a real expense I already recorded**, when I remember a fragment of the name or the note but not which month it lived in.

Search does **not** replace History (browse year → open a month), Global Stats (aggregates), or the month-workspace Actuals block (edit this month’s tickets). It is a **read-only finder** over every `month_actual_expense` row the signed-in user owns.

Typical questions: *“when did I last pay that clinic?”* · *“what did I write on that café ticket?”* — answered without opening months one by one.

---

## 1. Goal

A new principal destination **Search** at `/[locale]/search` where the signed-in user types a fragment, presses **Search**, and sees matching actual tickets from **any year**, each row visually matching the month-workspace actuals list **without action buttons**.

Success looks like: on a 360px phone, one field + one button, a result that is obviously a ticket (name, category, optional note, amount), and enough **when** context (year + month) to open that month if they want to edit it there.

---

## 2. Out of scope (this slice)

Do **not** build:

- Search of incomes, reserved lines, templates, annuals, or categories.
- Live-as-you-type / debounce search (C13 is free-text names; this page is an explicit submit).
- Autocomplete, typeahead, or saved recent queries (PRD C13: autocomplete is not MVP).
- Filters (year, category, amount range), sort pickers, or pagination controls. One ordered list, hard cap (§6.5).
- Mutations: no edit, delete, undo-pass, swipe-to-delete, or pass-to-actual on this screen. Edit happens in the month workspace.
- Full-text search (`tsvector`), `pg_trgm`, `unaccent` extension, or extra columns for a search vector.
- Highlighting of the matched substring (keep the row identical to Actuals read state).
- Export, share-link extras beyond the URL query, or caching search payloads in the service worker (C11: online-only).

---

## 3. Actors and jobs

| Actor | Job on this screen |
| --- | --- |
| Allowlisted user | Type a fragment, submit, scan tickets, optionally open the source month. |
| Visitor / blocked Google user | Never see Search (same auth as every other screen). |
| Coding agent | Implement this spec; do not scan all tickets in the service or match in JavaScript. |

---

## 4. Information architecture and navigation

### 4.1 New menu item

- Label: `nav.search` — **en:** “Search” · **es:** “Buscar”.
- Route: `/[locale]/search`. Query: `?q=` (raw string as typed; sanitization is server-side).
- Icon: lucide **`Search`** (magnifying glass), same size as other nav icons (`size-5`).
- Active state: any path starting with `/search`.

### 4.2 Placement (normative)

Search is a **first-class destination** at the same IA level as Home and History — not nested inside History.

| Surface | Placement |
| --- | --- |
| **Desktop sidebar (`lg+`)** | Home · Stats · Fixed · Annuals · Categories · History · **Search** · Settings |
| **Mobile bottom nav** | Unchanged 5 items: Home · Stats · Fixed · **More** · Settings |
| **More sheet** | **Search** (first) · Annuals · Categories · History |

Search is first in More so the magnifying glass is the first overflow row on a phone. Settings stays in the bar.

Update STYLE-GUIDE §4 when implementing so the live nav spec matches this table.

### 4.3 Distinct from existing surfaces

| Surface | Job | Must stay |
| --- | --- | --- |
| Home / month workspace | Capture and steer **this** month | Unchanged |
| Month workspace → Actuals | Add / edit / delete **this month’s** tickets | Unchanged |
| History | Browse **years** and open a month | Unchanged |
| Global Stats | Compare **aggregates** across years | Unchanged |
| **Search (this UC)** | Find **individual tickets** by name or note | New |

---

## 5. Query contract (normative)

Integer cents in the DTO (ADR-5). The database still stores `numeric(14,2)`. Never `number`/`float` arithmetic. Matching runs in **SQL**; the service must not load the tenant’s full ticket list and filter it in memory.

### 5.1 What is searched

**Table:** `month_actual_expense` only.

**Match:** `name OR observations` (null observations do not match unless the other column does).

**Not matched:** category name, amount, year, month number, converted-from metadata.

### 5.2 Tenancy (P0)

`month_actual_expense` has no `user_id`. Every search **joins** `month` and filters `month.user_id = userId`. A missing join is a P0 bug (PRD §5.1). User B never sees User A’s tickets, including via a crafted `?q=`.

Join `category` for the display name (active **and** inactive — PRD §6.2). Soft-deleted categories still label historical tickets; render the same inactive note the Actuals row uses.

### 5.3 Sanitize, then LIKE

The user types accents, extra spaces, and mixed case. The wire query is **not** used raw in SQL.

Canonical helper (unit-tested, used by the service **before** the repository runs):

`sanitizeSearchTerm(raw: string): string | null`

| Step | Rule |
| --- | --- |
| 1. Length cap | If `raw` is longer than **80** characters, slice to 80 (same cap as ticket `name`). |
| 2. Unicode fold | `normalize('NFD')` then strip combining marks (`\p{M}`). This turns `é` → `e`, `ñ` → `n`, `ü` → `u`. |
| 3. Case | Lowercase with a locale-independent transform (`toLowerCase` on the folded string is enough for `en`/`es`). |
| 4. Trim + collapse | Trim; collapse internal whitespace to a **single space**. |
| 5. Minimum | If the result is shorter than **2** characters, return `null` (do not query). |
| 6. LIKE escape | Escape `\`, `%`, and `_` so a user typing `%` does not mean “match everything”. |

The repository binds the escaped term as a parameter. Pattern:

```text
'%' || $sanitized || '%'  ESCAPE '\'
```

**Both sides** of the comparison must be accent-folded and lowercased. Folding only the input would miss a stored `Café` when the user types `cafe`.

SQL shape (illustrative — Drizzle `sql` fragment in the repository, not a new column):

```sql
SELECT
  month_actual_expense.id,
  month_actual_expense.month_id,
  month.year,
  month.month,
  month_actual_expense.category_id,
  category.name        AS category_name,
  category.active      AS category_active,
  month_actual_expense.name,
  month_actual_expense.observations,
  month_actual_expense.amount
FROM month_actual_expense
INNER JOIN month     ON month.id = month_actual_expense.month_id
INNER JOIN category  ON category.id = month_actual_expense.category_id
WHERE month.user_id = $userId
  AND (
        translate(lower(month_actual_expense.name),
                  'áàäâãåéèëêíìïîóòöôúùüûñçÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑÇ',
                  'aaaaaaeeeeiiiioooouuuuncaaaaaaeeeeiiiioooouuuunc')
        LIKE '%' || $sanitized || '%' ESCAPE '\'
     OR translate(lower(COALESCE(month_actual_expense.observations, '')),
                  'áàäâãåéèëêíìïîóòöôúùüûñçÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑÇ',
                  'aaaaaaeeeeiiiioooouuuuncaaaaaaeeeeiiiioooouuuunc')
        LIKE '%' || $sanitized || '%' ESCAPE '\'
  )
ORDER BY month.year DESC, month.month DESC, month_actual_expense.created_at DESC
LIMIT 101
```

Keep the `translate` alphabet in **one shared constant** used by the SQL fragment. The TypeScript NFD fold and the SQL `translate` must agree for Spanish vowels, `ñ`, `ü`, and `ç`. Add a unit test that the same fixture string folded in TS matches the SQL `translate` result (integration test on Postgres 16).

Use **`LIKE`**, not `ILIKE`: both sides are already lowercased. `ILIKE` is redundant and typically slower.

**Optimal LIKE (what this means here):**

- Parameterized query only — never concatenate `raw` into SQL.
- Escape wildcards so the pattern is a substring, not a user-controlled glob.
- Filter in `WHERE`, not in the service.
- `LIMIT 101` (see §5.5) so a broad term cannot dump thousands of rows onto a phone.
- Leading-wildcard `LIKE '%term%'` **cannot** use a B-tree. That is accepted. Do **not** add a GIN/`pg_trgm` index in this slice. Revisit only if a query is slow in production (PO decision — would be a migration).

Do **not** enable `CREATE EXTENSION unaccent`. The fold above is enough for `en`/`es` ticket text.

### 5.4 Semantics

- One substring, not tokenized AND/OR. Query `oat milk` matches a note that contains that consecutive folded string; it does not mean “oat AND milk” in any order.
- `name` match **or** `observations` match is enough (SQL `OR`).
- Hard-deleted tickets are absent (they are gone — PRD C15). No extra `deleted` filter.
- Months are never auto-created (C6). Search never creates rows.

### 5.5 Result cap

Return at most **100** hits. If the query finds 101 rows, return 100 and set `truncated: true` so the UI can say the list is capped. No “load more” in this slice.

### 5.6 Idle vs too-short vs empty

| `?q=` | Repository | UI |
| --- | --- | --- |
| Missing or whitespace-only | **Do not call** | Idle state (§8.4) |
| Sanitizes to `null` (1 character after fold, etc.) | **Do not call** | Too-short error on the form |
| Sanitizes to a term, 0 rows | Called | No-match empty state |
| Sanitizes to a term, 1–100 rows | Called | Ledger |

---

## 6. Layering

| Layer | Responsibility |
| --- | --- |
| Route `src/app/[locale]/search/page.tsx` | RSC. `requireUserId()`. Read `searchParams.q`. Load currency. Call the service. Render shell + client island for the form. |
| Form | `method="GET"` on `/[locale]/search` (locale-aware). Submit is the **Search** button and the keyboard Search/Enter key. **No server action** — this is a read (ADR-6). |
| Service `searchActuals(userId, rawQuery)` | Sanitize; if `null` return `{ status: 'idle' }` or `{ status: 'tooShort' }`; else call repo; map amounts with `parseAmount` → integer cents. |
| Repository `searchActualsByText(userId, sanitizedTerm)` | The SQL in §5.3. `userId` first. |

Suggested DTO (names may change; the fields may not):

```ts
type SearchActualHit = {
  id: string;
  monthId: string;
  year: number;
  month: number; // 1–12
  categoryId: string;
  categoryName: string;
  categoryActive: boolean;
  name: string;
  observations: string | null;
  amountCents: number;
};
```

Do **not** put `convertedFromLineId` / edit chrome on this DTO. Search is not the undo surface.

---

## 7. Routes / URL

`/[locale]/search`  
`/[locale]/search?q={raw}`

- Back/share work: the submitted query lives in the URL.
- The input’s default value is the raw `q` (what the user typed), **not** the folded term — so `Café` stays `Café` in the box after submit.
- Invalid/too-short `q` stays in the URL; the page shows the validation message and does not query.

---

## 8. Screen — first-mobile UI (normative)

**Subject:** a household ticket finder. **Audience:** the same person who logs spend on a phone in a minute. **Single job:** type a fragment → see matching tickets.

STYLE-GUIDE tokens only. No cream/serif, no acid-green-on-black, no broadsheet hairlines. No brand gradient on this page (the gradient is reserved for the month savings hero and the PWA banner).

### 8.1 Design tokens (from STYLE-GUIDE §1 / §3)

| Role | Token | Hex |
| --- | --- | --- |
| Page | `offwhite` / `--background` | `#F6F8FB` |
| Title + year spine | `navy` / `--primary` | `#1B3A6B` |
| Ticket name | `ink` / `--foreground` | `#0F1E33` |
| Category, notes, captions | `slate` / `--muted-foreground` | `#5B6B7F` |
| Finder dock | `sky-tint` / `--secondary` | `#E8F4FD` |
| Rows | `--card` white | `#FFFFFF` |

Dark mode uses the existing `--background` / `--card` / `--primary` mapping. Do not add Search-only hex values.

**Type:** Pilat Wide Bold for the `h1` and year labels (app-wide mandate). Ticket rows use the same face at `text-sm` / `text-xs` as Actuals. Amounts: `tabular-nums`, `formatMoney`, right-aligned.

**Signature (the one memorable thing):** a **year spine** — sticky year labels that turn a flat LIKE result into a ledger through time. Everything else stays quiet: one sky-tint finder, Actuals-shaped rows, no extra badges, no numbered 01/02 markers.

**Critique vs a generic search page:** a default screen would be a pill input, live suggestions, and an ungrouped list. This page **submits on purpose**, groups by **when** (the missing dimension vs in-month Actuals), and reuses the ticket row the user already knows. The dock is sky-tint (brand info surface), not a floating glassmorphism bar.

### 8.2 Mobile layout (360px base)

```
┌─────────────────────────────┐
│ Search                      │  h1, text-2xl, not a hero KPI
├─────────────────────────────┤
│ ┌─────────────────────────┐ │
│ │ Name or note            │ │  type=search, h-11 (44px)
│ │                         │ │
│ │ [ Search ]              │ │  primary, full width, h-11
│ └─────────────────────────┘ │  sticky finder (sky-tint card)
├─────────────────────────────┤
│ 12 tickets                  │  count, text-sm, not a big number
│                             │
│ 2026                        │  sticky year spine
│ March                       │  locale month name, text-lg
│ ┌─────────────────────────┐ │
│ │ Ticket name             │ │  Actuals read row, no buttons
│ │ Category          12.00 │ │
│ │ optional note           │ │
│ └─────────────────────────┘ │
│ February                    │
│ ┌─────────────────────────┐ │
│ │ …                       │ │
└─────────────────────────────┘
```

- **Finder dock:** sticky under the profile chip / page title (`sticky top-0` inside main, with `bg` so rows do not show through). Padding `p-4`; `rounded-[var(--radius)]`; sky-tint background; 1px `--border`. Input **above** the button on the 360px base so both hit 44px. At `md+`, input and button sit on one row (input flex-1, button shrink-0).
- **No FAB.** The Search button is the form submit, not a floating add control.
- Bottom nav already consumes the thumb zone; the dock stays at the **top** so results scroll under the thumbs, not under the form.

### 8.3 Ticket row (read-only Actuals)

Reuse the **read** layout of `src/app/[locale]/months/[year]/[month]/actuals-screen.tsx` `ActualRow` (name, category, optional italic observations, tabular `formatMoney`, inactive-category caption).

**Strip:**

- `RowActions` (edit / undo / delete)
- `SwipeAction`
- Inline edit form

**Add (Search-only, because the user is not inside a month):**

- Grouping: **year** (spine) then **month** (locale name via `monthName`, never hardcoded).
- The row is a **link** to `/[locale]/months/{year}/{month}` (the whole row, not a second “Open” button). This is navigation, not a mutation. Opening the month uses the existing workspace; the resume cookie may update the same way a History open does.
- `href` must not include fragment-scroll to a ticket id in this slice (no such anchors exist).

Do not restyle amounts, do not add a category color chip, do not show `converted_from` state. Extract a shared presentational row **only if** it keeps Actuals behavior identical; otherwise duplicate the read markup rather than regressing UC-08.

### 8.4 Copy (keyed, both locales)

Write from the user’s side. Same verb on the nav, the `h1`, and the button: Search / Buscar.

| Key | en | es |
| --- | --- | --- |
| `nav.search` | Search | Buscar |
| `search.title` | Search | Buscar |
| `search.placeholder` | Name or note | Nombre o nota |
| `search.actions.submit` | Search | Buscar |
| `search.idle` | Find a ticket from any year. Search matches the name or the note. | Encuentra un gasto de cualquier año. La búsqueda mira el nombre o la nota. |
| `search.tooShort` | Type at least two letters. | Escribe al menos dos letras. |
| `search.empty` | No tickets match “{q}”. Try another word. | Ningún gasto coincide con “{q}”. Prueba otra palabra. |
| `search.count` | {count, plural, one {# ticket} other {# tickets}} | {count, plural, one {# gasto} other {# gastos}} |
| `search.truncated` | Showing the first 100. Narrow the search. | Mostrando los primeros 100. Afina la búsqueda. |
| `search.inactiveCategory` | Reuse `actuals.historicalInactiveNote` (do not invent a second string). | same |
| `search.a11y.results` | Results | Resultados |

Idle and empty states are **invitations**, not apologies. No illustration, no emoji.

### 8.5 Motion and a11y

- After submit, move focus to the results heading (`search.a11y.results` + count) so a screen reader hears the outcome.
- `aria-live="polite"` on the results region.
- Input: `type="search"`, `enterKeyHint="search"`, `autoComplete="off"`, `maxLength={80}`, `aria-label` from `search.placeholder` if the visible label is visually hidden. Prefer a visible `<label>` on mobile (“Name or note”).
- Keyboard: Enter submits. Visible `focus-visible` ring (`--ring`).
- `prefers-reduced-motion: reduce` → no result entrance animation. If motion is used at all, **one** short fade of the results list after submit — not per-row stagger.
- Contrast: navy-on-sky-tint and ink-on-white already verified in STYLE-GUIDE §6.

### 8.6 Desktop (`lg+`)

Same page, `max-w-4xl` (not the Stats `max-w-6xl` exception). Finder stays a single dock; the year spine can sit as a left eyebrow while month groups fill the column. Do not build a two-pane “results | preview” layout.

---

## 9. i18n keys (namespaces)

All strings keyed in `en` + `es` (parity test). Suggested tree:

- `nav.search`
- `search.title`, `search.placeholder`, `search.actions.submit`
- `search.idle`, `search.tooShort`, `search.empty`, `search.count`, `search.truncated`
- `search.a11y.results`

Month names from `monthName` / locale, never from copy. Amounts via `formatMoney` (dot decimal, grouping per existing helper). No hardcoded category names in fixtures or copy.

---

## 10. Acceptance criteria / tests

Mapped PRD §15 scenarios: **#23, #24, #25**. Plus the slice tests below.

### 10.1 Unit (`sanitizeSearchTerm`)

1. `"  Café  "` → `"cafe"` (trim, fold, lower).
2. `"niño"` → `"nino"`.
3. `"a"` → `null` (too short).
4. `"%all%"` → escaped so `%` and `_` are literals (`\%all\%` or equivalent).
5. Internal `"oat    milk"` → `"oat milk"`.
6. Empty / whitespace-only → `null`.

### 10.2 Integration (real Postgres)

7. Every search SQL includes `month.user_id = userId`. User B querying the same `q` as User A gets **zero** of A’s rows (PRD §15 #2 pattern / **#23**).
8. Stored name with an accent matches the folded query (fixture name `"Café Central"`, query `"cafe"` → one hit). Use **only** this kind of synthetic fixture — never production merchant names or real amounts from a local dump.
9. Match on **observations** only (name does not contain the term; note does).
10. `OR` is inclusive: a row matching both name and note is returned **once**.
11. Wildcard query `"%"` after sanitize/escape does **not** return every ticket.
12. Too-short query does not hit the database (spy or: no result rows + `tooShort` status).
13. Hard-deleted actual disappears from search (PRD C15 / **#25**).
14. Inactive category: ticket still returned; DTO has `categoryActive: false`.
15. Incomes and reserved lines with the same name are **not** returned.
16. Result order: newer year first, then newer month, then newer `created_at`.
17. 101 matching fixtures → 100 hits and `truncated: true`.

### 10.3 E2E (Playwright, chromium + mobile-safari)

18. Sign-in → More → **Search** (magnifying glass) → `/[locale]/search`. Desktop sidebar also has Search after History.
19. Idle copy visible; no ticket list until submit.
20. Submit a query that matches a seeded ticket → row shows name, category, amount; **no** edit / delete / undo controls; observations shown when present.
21. Tap a result → month workspace for that year/month.
22. Spanish: title and button “Buscar”; month names in Spanish; amounts still dot-decimal (**#24** copy/i18n).
23. Too-short submit shows `search.tooShort`; network/DB is not required to change.
24. No-match query shows `search.empty` with the typed `q`.
25. Mobile: still exactly 5 bottom items; Search is inside More, not a sixth tab.

### 10.4 Visual / a11y / quality

26. Visible focus on input and submit. Results region is announced.
27. Typecheck + lint clean; i18n parity; no `userId`-less repository call.

---

## 11. Suggested files (implementation time)

| Path | Role |
| --- | --- |
| `src/app/[locale]/search/page.tsx` | RSC page |
| `src/app/[locale]/search/search-screen.tsx` | Client island: GET form + grouped read-only list |
| `src/server/services/search.ts` | Sanitize + orchestration |
| `src/server/repositories/search.ts` (or `actual.ts` new function) | SQL only |
| `src/lib/sanitize-search-term.ts` (or `src/server/search/sanitize.ts`) | Pure helper |
| `src/components/app-shell.tsx` | Desktop item + More item + `Search` icon |
| `src/i18n/messages/{en,es}.json` | Keys in §9 |
| `tests/unit/sanitize-search-term.test.ts` | §10.1 |
| `tests/integration/search.test.ts` | §10.2 |
| `tests/e2e/search.spec.ts` | §10.3 |

---

## 12. Open decisions (defaults apply unless the Product Owner overrides)

| # | Topic | Default in this spec |
| --- | --- | --- |
| D1 | Live search as the user types | **Off** — explicit Search button |
| D2 | `pg_trgm` / `unaccent` | **Out of scope** |
| D3 | Search incomes / reserved lines | **Out of scope** |
| D4 | Row tap opens the month | **On** (navigation, not a button chrome) |
| D5 | Highlight match in the name | **Off** (keep Actuals row identical) |

---

## Depends on

- **UC-01** (auth / tenancy), **UC-02** (i18n), **UC-03** (category names, including inactive), **UC-04** (currency label), **UC-06** (months exist), **UC-08** (actual tickets + row visual).
- Does **not** depend on UC-09 remaining edits, UC-10 undo chrome, UC-14 annuals, or UC-15 charts.
- **No schema change.**
