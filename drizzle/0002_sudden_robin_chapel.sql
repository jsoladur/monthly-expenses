CREATE TABLE "annual" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"observations" text,
	"charge_month" integer NOT NULL,
	"is_direct_debit" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "annual_charge_month_ck" CHECK ("annual"."charge_month" BETWEEN 1 AND 12)
);
--> statement-breakpoint
ALTER TABLE "annual" ADD CONSTRAINT "annual_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annual" ADD CONSTRAINT "annual_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "annual_reminder_idx" ON "annual" USING btree ("user_id","charge_month");