import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  char,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ============================================================================
// Enums (PostgreSQL 16, created once in UC-00; never altered by later slices)
// ============================================================================

export const categoryKindEnum = pgEnum("category_kind", ["expense", "income"]);

export const lineKindEnum = pgEnum("line_kind", ["committed", "estimated"]);

export const lineOriginEnum = pgEnum("line_origin", ["cloned", "month_only"]);

export const themePreferenceEnum = pgEnum("theme_preference", ["auto", "light", "dark"]);

// ============================================================================
// Identity and profile (1:1)
//
// app_user is named so because `user` is reserved in PostgreSQL.
// Rows are created ONLY after the ALLOWED_EMAILS check passes
// (PRD C3 / UC-01 / ARCH §3.2 rule 2).
// ============================================================================

export const appUser = pgTable("app_user", {
  id: uuid("id").primaryKey().defaultRandom(),
  googleSub: text("google_sub").notNull().unique(),
  email: text("email").notNull(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const profileSettings = pgTable("profile_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => appUser.id, { onDelete: "cascade" }),
  currency: char("currency", { length: 3 }).notNull().default("EUR"),
  theme: themePreferenceEnum("theme").notNull().default("auto"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ============================================================================
// Global per-user catalogs — SOFT delete only (PRD §13)
// ============================================================================

export const category = pgTable(
  "category",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: categoryKindEnum("kind").notNull(),
    // Savings category (PRD C24, UC-24). Money still leaves "available"; only
    // reporting splits it from spending. Expense categories only.
    countsAsSavings: boolean("counts_as_savings").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "category_savings_kind_ck",
      sql`${table.countsAsSavings} = false OR ${table.kind} = 'expense'`,
    ),
    // Partial unique: names are unique per (user, kind) only among ACTIVE rows
    // (PRD §6.2). Soft-deleted rows free the name for re-use.
    uniqueIndex("category_active_name_uk")
      .on(table.userId, table.kind, table.name)
      .where(sql`${table.active} = true`),
  ],
);

export const template = pgTable(
  "template",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => category.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    observations: text("observations"),
    // numeric(14,2): domain code uses integer cents (ADR-5, ARCH §8).
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    kind: lineKindEnum("kind").notNull(),
    // Month schedule (PRD C23, UC-20). NULL = every month; otherwise the
    // sorted unique month-numbers (1-12) the template applies to. The service
    // normalizes "all 12" to NULL, so a stored array has 1..11 entries.
    months: smallint("months").array(),
    // Last payment month (PRD C29, UC-29) of a COMMITTED template (loans,
    // instalments). Both NULL = no end. The template is cloned into months up
    // to and including it; creating a month on or after it deactivates the
    // template.
    endYear: smallint("end_year"),
    endMonth: smallint("end_month"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    // Clone source at month creation = active templates of the user that
    // apply to the new month-number (PRD C17 / C23). Overspend baseline =
    // sum of those templates per category (PRD §7.4).
    index("template_clone_idx").on(table.userId, table.active, table.kind),
    index("template_category_idx").on(table.categoryId),
    check(
      "template_months_ck",
      sql`${table.months} IS NULL OR (cardinality(${table.months}) BETWEEN 1 AND 11 AND ${table.months} <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[])`,
    ),
    check(
      "template_end_ck",
      sql`(${table.endYear} IS NULL AND ${table.endMonth} IS NULL) OR (${table.endYear} IS NOT NULL AND ${table.endMonth} IS NOT NULL AND ${table.kind} = 'committed' AND ${table.endMonth} BETWEEN 1 AND 12 AND ${table.endYear} BETWEEN 1970 AND 9999)`,
    ),
  ],
);

export const annual = pgTable(
  "annual",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => category.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    observations: text("observations"),
    amount: numeric("amount", { precision: 14, scale: 2 }),
    chargeMonth: integer("charge_month").notNull(),
    isDirectDebit: boolean("is_direct_debit").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    check("annual_charge_month_ck", sql`${table.chargeMonth} BETWEEN 1 AND 12`),
    index("annual_reminder_idx").on(table.userId, table.chargeMonth),
  ],
);

// ============================================================================
// Month instance and money rows — HARD delete on the money rows (PRD §13)
//
// Month is never auto-created (PRD C6/C12). On creation, active templates
// are cloned ONCE into month_fixed_line; afterwards the month never syncs
// with templates or other months (PRD §7.8). No rollover (PRD C7).
// ============================================================================

export const month = pgTable(
  "month",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("month_user_period_uk").on(table.userId, table.year, table.month),
    check("month_range_ck", sql`${table.month} BETWEEN 1 AND 12`),
  ],
);

export const monthIncome = pgTable(
  "month_income",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    monthId: uuid("month_id")
      .notNull()
      .references(() => month.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => category.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("month_income_month_idx").on(table.monthId)],
);

export const monthFixedLine = pgTable(
  "month_fixed_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    monthId: uuid("month_id")
      .notNull()
      .references(() => month.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => category.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    observations: text("observations"),
    remainingAmount: numeric("remaining_amount", { precision: 14, scale: 2 }).notNull(),
    originalAmount: numeric("original_amount", { precision: 14, scale: 2 }).notNull(),
    kind: lineKindEnum("kind").notNull(),
    origin: lineOriginEnum("origin").notNull().default("cloned"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("month_fixed_line_month_idx").on(table.monthId),
    index("month_fixed_line_kind_idx").on(table.monthId, table.kind),
  ],
);

export const monthActualExpense = pgTable(
  "month_actual_expense",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    monthId: uuid("month_id")
      .notNull()
      .references(() => month.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => category.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    observations: text("observations"),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    // Logical reference only — NO foreign key: pass-to-actual hard-deletes the
    // source line in the same transaction; undo re-inserts it with the same id
    // (ARCH §4, PRD §7.5).
    convertedFromLineId: uuid("converted_from_line_id"),
    convertedLineOriginalAmount: numeric("converted_line_original_amount", {
      precision: 14,
      scale: 2,
    }),
    convertedLineOrigin: lineOriginEnum("converted_line_origin"),
    convertedLineKind: lineKindEnum("converted_line_kind"),
    editedAfterConversion: boolean("edited_after_conversion").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("month_actual_expense_month_idx").on(table.monthId),
    // Overspend warning: sum(amount) of actuals per category for the open
    // month (PRD §7.4).
    index("month_actual_expense_overspend_idx").on(table.monthId, table.categoryId),
  ],
);

// ============================================================================
// Inferred row types — convenience for repositories and tests.
// Money columns are returned as strings by postgres-js (Drizzle default).
// ============================================================================

export type AppUser = typeof appUser.$inferSelect;
export type NewAppUser = typeof appUser.$inferInsert;
export type ProfileSettings = typeof profileSettings.$inferSelect;
export type NewProfileSettings = typeof profileSettings.$inferInsert;
export type Category = typeof category.$inferSelect;
export type NewCategory = typeof category.$inferInsert;
export type Template = typeof template.$inferSelect;
export type NewTemplate = typeof template.$inferInsert;
export type Annual = typeof annual.$inferSelect;
export type NewAnnual = typeof annual.$inferInsert;
export type Month = typeof month.$inferSelect;
export type NewMonth = typeof month.$inferInsert;
export type MonthIncome = typeof monthIncome.$inferSelect;
export type NewMonthIncome = typeof monthIncome.$inferInsert;
export type MonthFixedLine = typeof monthFixedLine.$inferSelect;
export type NewMonthFixedLine = typeof monthFixedLine.$inferInsert;
export type MonthActualExpense = typeof monthActualExpense.$inferSelect;
export type NewMonthActualExpense = typeof monthActualExpense.$inferInsert;

export type CategoryKind = (typeof categoryKindEnum.enumValues)[number];
export type LineKind = (typeof lineKindEnum.enumValues)[number];
export type LineOrigin = (typeof lineOriginEnum.enumValues)[number];
export type ThemePreference = (typeof themePreferenceEnum.enumValues)[number];
