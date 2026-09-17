CREATE TYPE "public"."style_preference" AS ENUM('clean', 'basic');--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "style_preference" "style_preference" DEFAULT 'clean';