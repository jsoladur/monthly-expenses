# Style Guide — Monthly Expenses

> **Audience:** coding agents. Apply this file to EVERY screen (all UI slices: UC-03 and up, UC-12 PWA chrome).
> **Stack:** Tailwind CSS v4 + shadcn/ui (ADR-9) · Next.js App Router · mobile-first, adaptive to desktop (PRD §10) · installable PWA (PRD C11).
> **Brand source:** the app logo — a navy/blue shield with a dollar sign, a sky→green upward arrow, and a teal coin stack. Personality: trustworthy finance (navy), growth/savings (green arrow), calm minimalism (white space).

---

## 1. Brand palette (extracted from the logo)

| Token | Hex | HSL | Usage |
| --- | --- | --- | --- |
| `navy` | `#1B3A6B` | `217 60% 26%` | Primary actions, headers, committed lines, brand anchor |
| `blue` | `#2E7DB2` | `204 59% 44%` | Primary hover, links, focus ring |
| `sky` | `#3E9BD8` | `204 66% 55%` | Info accents, one-off badge, reminder cards, gradient start |
| `teal` | `#2AA198` | `175 59% 40%` | Estimated (envelope) lines |
| `green` | `#7CB342` | `89 46% 48%` | Savings-positive, income, gradient end |
| `green-deep` | `#4C7A1F` | `90 59% 30%` | Text/icons on green tints (AA-safe) |
| `amber` | `#B45309` | `26 90% 37%` | Overspend + past-month warnings (warn only, never red) |
| `red` | `#DC2626` | `0 72% 51%` | Destructive/hard-delete actions ONLY |
| `ink` | `#0F1E33` | `215 55% 13%` | Body text (light mode) |
| `slate` | `#5B6B7F` | `213 17% 43%` | Muted/secondary text |
| `offwhite` | `#F6F8FB` | `216 38% 97%` | App background tint (light mode) |
| `border` | `#E2E8F0` | `214 32% 91%` | Hairline borders |
| `sky-tint` | `#E8F4FD` | `206 84% 95%` | Accent surfaces, selected states, reminder cards |
| `green-tint` | `#EFF7E3` | `84 56% 93%` | Success/income surfaces |

**Brand gradient** (from the logo arrow): `linear-gradient(135deg, #3E9BD8 0%, #7CB342 100%)`. Use ONLY for the potential-savings hero number background card and the PWA install banner. One gradient per screen, maximum.

Dark mode anchors: background `#0B1526` (`218 55% 10%`), card `#101E33` (`216 52% 13%`), foreground `#E8EEF6` (`214 44% 94%`), muted `#8FA3BC` (`213 25% 65%`), primary `#4FA3E0` (`205 70% 59%`), border `#1E3252` (`217 46% 22%`).

---

## 2. Typography (normative)

The Product Owner mandates this exact stack, with `!important`:

```css
font-family: "Pilat Wide Bold", "Pilat Wide Bold Fallback", -apple-system,
  BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
```

### Setup (Tailwind v4, `src/app/globals.css`)

```css
@font-face {
  font-family: "Pilat Wide Bold";
  src: url("/fonts/PilatWide-Bold.woff2") format("woff2");
  font-weight: 700;
  font-style: normal;
  font-display: swap; /* never block render on the webfont */
}

/* Metric-compatible stand-in while the webfont loads (prevents layout shift).
   Tune size-adjust once against the real font. */
@font-face {
  font-family: "Pilat Wide Bold Fallback";
  src: local("Arial Bold"), local("Helvetica Bold");
  size-adjust: 105%;
  font-weight: 700;
}

@theme {
  --font-sans: "Pilat Wide Bold", "Pilat Wide Bold Fallback", -apple-system,
    BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}

@layer base {
  body {
    font-family: var(--font-sans) !important;
    letter-spacing: -0.01em; /* wide display faces read better slightly tight */
  }
}
```

Rules:

- Self-host the woff2 at `public/fonts/PilatWide-Bold.woff2`. It is a commercial typeface — confirm the webfont license before shipping; never hotlink a foundry CDN without one.
- **Money always uses tabular figures:** every amount, total, and the savings hero gets `font-variant-numeric: tabular-nums` (add a `.amount` utility). Amounts are right-aligned in lists. **Display** is `150,923.67 €` (comma thousands, **dot** decimal, currency symbol) in both locales. **Input** stays `1234.56` with no grouping (PRD C9).
- Scale (mobile → desktop): display/savings hero `text-4xl md:text-5xl`, screen titles `text-2xl`, section headers `text-lg`, body `text-base`, captions/badges `text-xs`.
- Pilat Wide Bold is a display face: keep paragraphs short (this app is numeric, so it fits); if a long help text ever appears, cap it at `max-w-prose` and `text-sm`.

---

## 3. Design tokens (shadcn/ui CSS variables)

Replace the blank defaults in `globals.css`. Light mode:

```css
:root {
  --radius: 0.75rem;
  --background: 216 38% 97%;        /* offwhite */
  --foreground: 215 55% 13%;        /* ink */
  --card: 0 0% 100%;
  --card-foreground: 215 55% 13%;
  --popover: 0 0% 100%;
  --popover-foreground: 215 55% 13%;
  --primary: 217 60% 26%;           /* navy — white text = 11.3:1 AAA */
  --primary-foreground: 0 0% 100%;
  --secondary: 206 84% 95%;         /* sky-tint */
  --secondary-foreground: 217 60% 26%;
  --muted: 214 32% 91%;
  --muted-foreground: 213 17% 43%;  /* slate — 5.45:1 AA */
  --accent: 206 84% 95%;
  --accent-foreground: 217 60% 26%;
  --success: 89 46% 48%;            /* green */
  --success-foreground: 90 59% 30%; /* green-deep text on tints */
  --warning: 26 90% 37%;            /* amber — white text 5.02:1 AA */
  --warning-foreground: 0 0% 100%;
  --destructive: 0 72% 51%;         /* red — white text 4.83:1 AA */
  --destructive-foreground: 0 0% 100%;
  --border: 214 32% 91%;
  --input: 214 32% 91%;
  --ring: 204 59% 44%;              /* blue */
  /* Domain tokens (Monthly Expenses) */
  --committed: 217 60% 26%;         /* navy — fixed/committed lines */
  --estimated: 175 59% 40%;         /* teal — envelope lines */
  --one-off: 204 66% 55%;           /* sky — month_only badge + reminders */
  --income: 89 46% 48%;             /* green */
  --brand-gradient: linear-gradient(135deg, #3E9BD8 0%, #7CB342 100%);
}

.dark {
  --background: 218 55% 10%;
  --foreground: 214 44% 94%;        /* 15.6:1 AAA on background */
  --card: 216 52% 13%;
  --card-foreground: 214 44% 94%;
  --popover: 216 52% 13%;
  --popover-foreground: 214 44% 94%;
  --primary: 205 70% 59%;           /* lighter blue — bg text 6.65:1 AA */
  --primary-foreground: 218 55% 10%;
  --secondary: 217 46% 22%;
  --secondary-foreground: 214 44% 94%;
  --muted: 217 46% 22%;
  --muted-foreground: 213 25% 65%;  /* 7.08:1 AAA */
  --accent: 217 46% 22%;
  --accent-foreground: 214 44% 94%;
  --success: 89 46% 48%;
  --success-foreground: 84 56% 93%;
  --warning: 32 95% 44%;
  --warning-foreground: 218 55% 10%;
  --destructive: 0 72% 61%;
  --destructive-foreground: 218 55% 10%;
  --border: 217 46% 22%;
  --input: 217 46% 22%;
  --ring: 205 70% 59%;
  --committed: 205 70% 59%;
  --estimated: 175 55% 55%;
  --one-off: 204 66% 65%;
  --income: 89 46% 55%;
}
```

Tailwind v4 mapping (same file):

```css
@theme inline {
  --color-committed: hsl(var(--committed));
  --color-estimated: hsl(var(--estimated));
  --color-one-off: hsl(var(--one-off));
  --color-income: hsl(var(--income));
  --color-success: hsl(var(--success));
  --color-warning: hsl(var(--warning));
}
```

---

## 4. Layout — mobile-first, adaptive

- **Base = 360px phone.** Design every screen mobile-first; enhance at `md` (768px) and `lg` (1024px). Never design desktop-first and shrink.
- **App shell, mobile:** single column; sticky summary header; bottom navigation with **exactly 5** items — **Home · Stats · Fixed · More · Settings** — with `padding-bottom: env(safe-area-inset-bottom)` for PWA standalone mode. **More** opens a bottom sheet (`Drawer`) listing Annuals, Categories, History. Settings stays in the bar.
- **App shell, desktop (`lg+`):** left sidebar nav (240px, navy-tinted) with **Home · Stats · Fixed · Annuals · Categories · History · Settings** + content column `max-w-4xl mx-auto`. **Exception:** Global Stats (`/stats`) may use `max-w-6xl` so multi-year charts stay readable. The app must not look like a stretched phone: cap content width, increase whitespace, show blocks side by side.
- **Month workspace on `lg+`:** two-column grid — summary + incomes left, reserved lines + actuals right (`lg:grid-cols-2 lg:gap-8`). On mobile they stack: summary → reminders (if any) → actuals → reserved → incomes.
- **Touch targets ≥ 44×44px** everywhere; the add-actual button is a floating action button (bottom-right, above the bottom nav) on mobile and a regular primary button in the header on desktop.
- **Forms:** bottom sheet on mobile, centered dialog on `md+` (shadcn `Drawer`/`Dialog` responsive pattern). Amount field is the first field, `inputMode="decimal"`, right-aligned, `.amount` utility.
- **Spacing:** 4pt scale (`p-4` base screen padding, `gap-3` list rows, `gap-6`/`gap-8` between sections). Generous whitespace is the minimalism — not extra borders or dividers.

---

## 5. Component recipes

- **Buttons:** `primary` = navy bg + white text (11.3:1 AAA); `secondary` = sky-tint bg + navy text (10.1:1 AAA); `ghost` for row actions; `destructive` (red) ONLY for hard deletes (PRD §13 rows). Radius `var(--radius)`, no shadows on buttons.
- **Cards:** white (dark: `#101E33`), 1px `--border`, `rounded-[var(--radius)]`, shadow at most `shadow-sm`. Sections are cards; the page background is offwhite so cards read as surfaces.
- **Line-kind badges** (verified contrast pairs — use exactly these):
  - Committed → solid navy bg, white text (11.3:1).
  - Estimated → teal-tint bg (`#2AA198` at 12% opacity) + teal text, or solid teal with white text ONLY at badge size (3.16:1 = AA-large, acceptable for short bold labels).
  - Month-only (UC-13) → sky-tint bg + navy text + "one-off" label.
- **Reminders (UC-14 Annuals):** sky-tint info card + navy text + bell icon — informational, visually DISTINCT from amber warnings. One card per matching annual, stacked directly under the summary hero, with a ghost "Quick-add" action. Never amber, never red.
- **Potential-savings hero:** the only gradient element — brand gradient card, white tabular-nums number, label from i18n keys. Positive number in white; if negative, switch the card to solid `--destructive` (no gradient) so the state is unmistakable.
- **Warnings:** amber, never blocking (PRD §7.4). Overspend = amber badge on the category row; past-month = amber banner under the header. Red is reserved for destructive actions, not warnings.
- **Lists:** one row per money line — name (truncated), category badge, right-aligned tabular amount. Tap row → edit sheet. Delete lives inside the edit sheet, not as a row trash icon (prevents mis-taps on mobile).
- **Empty states:** ink illustration-free — big tabular "0.00", one sentence of keyed copy (PRD §19), one primary button. No stock images.
- **403 page:** centered, navy shield logo, keyed copy, no nav chrome (PRD C3 — no app shell).
- **Focus:** 2px `--ring` outline, `focus-visible` only. Never remove outlines.

---

## 6. Accessibility (verified)

Contrast ratios computed for this palette: white-on-navy 11.27:1 (AAA), ink-on-white 16.75:1 (AAA), slate-on-white 5.45:1 (AA), white-on-amber 5.02:1 (AA), white-on-red 4.83:1 (AA), navy-on-sky-tint 10.08:1 (AAA), dark-mode body 15.65:1 (AAA). Rules: never put white text on `green` (use `green-deep` on `green-tint` instead); never put small white text on teal; warnings always amber, reminders always sky-tint, errors always paired with an icon + text, never color alone.

---

## 7. PWA chrome (UC-12)

- `theme-color`: `#1B3A6B` (light) / `#0B1526` (dark) via media-query meta tags.
- Icons in `public/icons/`: logo on a white (or `#0B1526` dark) padded background — never transparent-edge crop; maskable icon needs 20% safe padding.
- Splash/install banner: brand gradient allowed here (second permitted use).

---

## 8. Minimalism rules for agents (do / don't)

- DO: one accent color per screen; let the savings hero be the loudest element; use whitespace instead of dividers; keep the palette to the tokens above.
- DON'T: introduce new hex values outside §1/§3 (extend tokens instead); add gradients beyond the two sanctioned spots; use shadows heavier than `shadow-sm`; use red for anything except destructive actions; add illustrations, stock photos, or emoji as decoration.
