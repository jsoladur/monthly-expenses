CREATE TYPE "public"."theme_preference" AS ENUM('auto', 'light', 'dark');--> statement-breakpoint
ALTER TABLE "profile_settings" ADD COLUMN "theme" "theme_preference" DEFAULT 'auto' NOT NULL;