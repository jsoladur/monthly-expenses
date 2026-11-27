-- ============================================================================
-- 0008 — UC-31 collaborative workspaces: the tenancy change (PRD C30–C31,
-- ARCH ADR-12). Forward-only. Order of operations = UC-31 §6.
--
-- PRECONDITIONS (UC-31 §6): both app instances STOPPED for the whole run,
-- migrations 0000–0007 applied, a restorable backup taken. Old code writes
-- `user_id`; after step 5 that column is gone and old code fails on writes.
--
-- The Drizzle migrator runs every pending migration in ONE transaction, so a
-- failed verification (step 7) rolls the whole migration back.
-- ============================================================================

-- 1. Enums -------------------------------------------------------------------
CREATE TYPE "public"."workspace_kind" AS ENUM('private', 'shared');--> statement-breakpoint
CREATE TYPE "public"."workspace_role" AS ENUM('owner', 'admin', 'editor', 'reader');--> statement-breakpoint

-- 2. workspace + workspace_member with the UC-31 §4.7 invariants -------------
CREATE TABLE "workspace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "workspace_kind" NOT NULL,
	"personal_user_id" uuid,
	"name" text,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_private_user_ck" CHECK (("workspace"."kind" = 'private') = ("workspace"."personal_user_id" IS NOT NULL)),
	CONSTRAINT "workspace_shared_name_ck" CHECK ("workspace"."kind" = 'private' OR "workspace"."name" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "workspace_member" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "workspace_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_member_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_personal_user_id_app_user_id_fk" FOREIGN KEY ("personal_user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_personal_user_uk" ON "workspace" USING btree ("personal_user_id") WHERE "workspace"."personal_user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_member_owner_uk" ON "workspace_member" USING btree ("workspace_id") WHERE "workspace_member"."role" = 'owner';--> statement-breakpoint
CREATE INDEX "workspace_member_user_idx" ON "workspace_member" USING btree ("user_id");--> statement-breakpoint

-- Snapshot of the per-user row counts BEFORE anything is re-pointed (step 7).
CREATE TEMP TABLE "_uc31_before" ON COMMIT DROP AS
SELECT u.id AS user_id, x.t, x.n FROM "app_user" u
CROSS JOIN LATERAL (
	SELECT 'category'::text AS t, count(*)::bigint AS n FROM "category" WHERE "user_id" = u.id
	UNION ALL SELECT 'template', count(*) FROM "template" WHERE "user_id" = u.id
	UNION ALL SELECT 'annual', count(*) FROM "annual" WHERE "user_id" = u.id
	UNION ALL SELECT 'month', count(*) FROM "month" WHERE "user_id" = u.id
	UNION ALL SELECT 'month_income', count(*) FROM "month_income" i JOIN "month" m ON m.id = i.month_id WHERE m."user_id" = u.id
	UNION ALL SELECT 'month_fixed_line', count(*) FROM "month_fixed_line" l JOIN "month" m ON m.id = l.month_id WHERE m."user_id" = u.id
	UNION ALL SELECT 'month_actual_expense', count(*) FROM "month_actual_expense" a JOIN "month" m ON m.id = a.month_id WHERE m."user_id" = u.id
) x;--> statement-breakpoint
CREATE TEMP TABLE "_uc31_totals" ON COMMIT DROP AS
SELECT 'category'::text AS t, count(*)::bigint AS n FROM "category"
UNION ALL SELECT 'template', count(*) FROM "template"
UNION ALL SELECT 'annual', count(*) FROM "annual"
UNION ALL SELECT 'month', count(*) FROM "month"
UNION ALL SELECT 'month_income', count(*) FROM "month_income"
UNION ALL SELECT 'month_fixed_line', count(*) FROM "month_fixed_line"
UNION ALL SELECT 'month_actual_expense', count(*) FROM "month_actual_expense";--> statement-breakpoint

-- 3. One private workspace + Owner membership for EVERY app_user -------------
INSERT INTO "workspace" ("kind", "personal_user_id", "currency")
SELECT 'private', u.id, COALESCE(p."currency", 'EUR')
FROM "app_user" u
LEFT JOIN "profile_settings" p ON p."user_id" = u.id;--> statement-breakpoint
INSERT INTO "workspace_member" ("workspace_id", "user_id", "role")
SELECT w.id, w."personal_user_id", 'owner'
FROM "workspace" w
WHERE w."kind" = 'private';--> statement-breakpoint

-- 4. workspace_id on the four tenant tables, backfilled from user_id ---------
ALTER TABLE "category" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "annual" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
ALTER TABLE "month" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
UPDATE "category" t SET "workspace_id" = w.id FROM "workspace" w WHERE w."personal_user_id" = t."user_id";--> statement-breakpoint
UPDATE "template" t SET "workspace_id" = w.id FROM "workspace" w WHERE w."personal_user_id" = t."user_id";--> statement-breakpoint
UPDATE "annual" t SET "workspace_id" = w.id FROM "workspace" w WHERE w."personal_user_id" = t."user_id";--> statement-breakpoint
UPDATE "month" t SET "workspace_id" = w.id FROM "workspace" w WHERE w."personal_user_id" = t."user_id";--> statement-breakpoint
ALTER TABLE "category" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "template" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "annual" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "month" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual" ADD CONSTRAINT "annual_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month" ADD CONSTRAINT "month_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- 5. Drop the user_id indexes/columns; create the workspace replacements ----
DROP INDEX "category_active_name_uk";--> statement-breakpoint
DROP INDEX "month_user_period_uk";--> statement-breakpoint
DROP INDEX "template_clone_idx";--> statement-breakpoint
DROP INDEX "annual_reminder_idx";--> statement-breakpoint
ALTER TABLE "category" DROP CONSTRAINT "category_user_id_app_user_id_fk";--> statement-breakpoint
ALTER TABLE "template" DROP CONSTRAINT "template_user_id_app_user_id_fk";--> statement-breakpoint
ALTER TABLE "annual" DROP CONSTRAINT "annual_user_id_app_user_id_fk";--> statement-breakpoint
ALTER TABLE "month" DROP CONSTRAINT "month_user_id_app_user_id_fk";--> statement-breakpoint

-- 6. created_by_user_id on actuals = the owner of the row's private workspace
--    (done before user_id goes, while every workspace is still private).
ALTER TABLE "month_actual_expense" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
UPDATE "month_actual_expense" a SET "created_by_user_id" = w."personal_user_id"
FROM "month" m JOIN "workspace" w ON w.id = m."workspace_id"
WHERE m.id = a."month_id";--> statement-breakpoint
ALTER TABLE "month_actual_expense" ALTER COLUMN "created_by_user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "month_actual_expense" ADD CONSTRAINT "month_actual_expense_created_by_user_id_app_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- 7. Verification — fail the whole migration on any mismatch ----------------
DO $$
DECLARE
	bad_totals int;
	bad_users int;
BEGIN
	SELECT count(*) INTO bad_totals FROM "_uc31_totals" b
	JOIN (
		SELECT 'category'::text AS t, count(*)::bigint AS n FROM "category"
		UNION ALL SELECT 'template', count(*) FROM "template"
		UNION ALL SELECT 'annual', count(*) FROM "annual"
		UNION ALL SELECT 'month', count(*) FROM "month"
		UNION ALL SELECT 'month_income', count(*) FROM "month_income"
		UNION ALL SELECT 'month_fixed_line', count(*) FROM "month_fixed_line"
		UNION ALL SELECT 'month_actual_expense', count(*) FROM "month_actual_expense"
	) a USING (t)
	WHERE a.n <> b.n;
	IF bad_totals > 0 THEN
		RAISE EXCEPTION 'UC-31 migration 0008: total row counts changed (% tables)', bad_totals;
	END IF;

	SELECT count(*) INTO bad_users FROM "_uc31_before" b
	JOIN "workspace" w ON w."personal_user_id" = b.user_id
	CROSS JOIN LATERAL (
		SELECT CASE b.t
			WHEN 'category' THEN (SELECT count(*) FROM "category" WHERE "workspace_id" = w.id)
			WHEN 'template' THEN (SELECT count(*) FROM "template" WHERE "workspace_id" = w.id)
			WHEN 'annual' THEN (SELECT count(*) FROM "annual" WHERE "workspace_id" = w.id)
			WHEN 'month' THEN (SELECT count(*) FROM "month" WHERE "workspace_id" = w.id)
			WHEN 'month_income' THEN (SELECT count(*) FROM "month_income" i JOIN "month" m ON m.id = i.month_id WHERE m."workspace_id" = w.id)
			WHEN 'month_fixed_line' THEN (SELECT count(*) FROM "month_fixed_line" l JOIN "month" m ON m.id = l.month_id WHERE m."workspace_id" = w.id)
			WHEN 'month_actual_expense' THEN (SELECT count(*) FROM "month_actual_expense" a JOIN "month" m ON m.id = a.month_id WHERE m."workspace_id" = w.id)
		END AS n
	) a
	WHERE a.n <> b.n;
	IF bad_users > 0 THEN
		RAISE EXCEPTION 'UC-31 migration 0008: per-user row counts differ after backfill (% mismatches)', bad_users;
	END IF;

	IF (SELECT count(*) FROM "app_user") <> (SELECT count(*) FROM "workspace" WHERE "kind" = 'private') THEN
		RAISE EXCEPTION 'UC-31 migration 0008: not every app_user has exactly one private workspace';
	END IF;
END $$;--> statement-breakpoint

-- 5 (cont.). Now that the counts are verified, drop user_id and recreate the
-- indexes on workspace_id.
ALTER TABLE "category" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "template" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "annual" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "month" DROP COLUMN "user_id";--> statement-breakpoint
CREATE UNIQUE INDEX "category_active_name_uk" ON "category" USING btree ("workspace_id","kind","name") WHERE "category"."active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "month_workspace_period_uk" ON "month" USING btree ("workspace_id","year","month");--> statement-breakpoint
CREATE INDEX "template_clone_idx" ON "template" USING btree ("workspace_id","active","kind");--> statement-breakpoint
CREATE INDEX "annual_reminder_idx" ON "annual" USING btree ("workspace_id","charge_month");--> statement-breakpoint

-- 8. profile_settings (currency, theme) and app_user are left as they are.
DROP TABLE "_uc31_before";--> statement-breakpoint
DROP TABLE "_uc31_totals";
