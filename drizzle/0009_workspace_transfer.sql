-- ============================================================================
-- 0009 — UC-32 workspace ownership transfer (PRD C32). Creates the pending
-- offer table only; no backfill. At most one offer per workspace
-- (workspace_transfer_workspace_uk); a row means "pending".
-- ============================================================================
CREATE TABLE "workspace_transfer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_transfer_not_self_ck" CHECK ("workspace_transfer"."from_user_id" <> "workspace_transfer"."to_user_id")
);
--> statement-breakpoint
ALTER TABLE "workspace_transfer" ADD CONSTRAINT "workspace_transfer_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_transfer" ADD CONSTRAINT "workspace_transfer_from_user_id_app_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_transfer" ADD CONSTRAINT "workspace_transfer_to_user_id_app_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_transfer_workspace_uk" ON "workspace_transfer" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_transfer_to_user_idx" ON "workspace_transfer" USING btree ("to_user_id");