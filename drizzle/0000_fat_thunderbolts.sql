CREATE TYPE "public"."category_kind" AS ENUM('expense', 'income');--> statement-breakpoint
CREATE TYPE "public"."line_kind" AS ENUM('committed', 'estimated');--> statement-breakpoint
CREATE TYPE "public"."line_origin" AS ENUM('cloned', 'month_only');--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_sub" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_google_sub_unique" UNIQUE("google_sub")
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "category_kind" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "month" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "month_range_ck" CHECK ("month"."month" BETWEEN 1 AND 12)
);
--> statement-breakpoint
CREATE TABLE "month_actual_expense" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"observations" text,
	"amount" numeric(14, 2) NOT NULL,
	"converted_from_line_id" uuid,
	"converted_line_original_amount" numeric(14, 2),
	"converted_line_origin" "line_origin",
	"edited_after_conversion" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "month_fixed_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"observations" text,
	"remaining_amount" numeric(14, 2) NOT NULL,
	"original_amount" numeric(14, 2) NOT NULL,
	"kind" "line_kind" NOT NULL,
	"origin" "line_origin" DEFAULT 'cloned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "month_income" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"observations" text,
	"amount" numeric(14, 2) NOT NULL,
	"kind" "line_kind" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month" ADD CONSTRAINT "month_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_actual_expense" ADD CONSTRAINT "month_actual_expense_month_id_month_id_fk" FOREIGN KEY ("month_id") REFERENCES "public"."month"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_actual_expense" ADD CONSTRAINT "month_actual_expense_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_fixed_line" ADD CONSTRAINT "month_fixed_line_month_id_month_id_fk" FOREIGN KEY ("month_id") REFERENCES "public"."month"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_fixed_line" ADD CONSTRAINT "month_fixed_line_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_income" ADD CONSTRAINT "month_income_month_id_month_id_fk" FOREIGN KEY ("month_id") REFERENCES "public"."month"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_income" ADD CONSTRAINT "month_income_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_settings" ADD CONSTRAINT "profile_settings_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "category_active_name_uk" ON "category" USING btree ("user_id","kind","name") WHERE "category"."active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "month_user_period_uk" ON "month" USING btree ("user_id","year","month");--> statement-breakpoint
CREATE INDEX "month_actual_expense_month_idx" ON "month_actual_expense" USING btree ("month_id");--> statement-breakpoint
CREATE INDEX "month_actual_expense_overspend_idx" ON "month_actual_expense" USING btree ("month_id","category_id");--> statement-breakpoint
CREATE INDEX "month_fixed_line_month_idx" ON "month_fixed_line" USING btree ("month_id");--> statement-breakpoint
CREATE INDEX "month_fixed_line_kind_idx" ON "month_fixed_line" USING btree ("month_id","kind");--> statement-breakpoint
CREATE INDEX "month_income_month_idx" ON "month_income" USING btree ("month_id");--> statement-breakpoint
CREATE INDEX "template_clone_idx" ON "template" USING btree ("user_id","active","kind");--> statement-breakpoint
CREATE INDEX "template_category_idx" ON "template" USING btree ("category_id");