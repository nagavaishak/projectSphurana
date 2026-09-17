ALTER TABLE "brand_kit" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "brand_logo" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "brand_font" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "brand_kit" CASCADE;--> statement-breakpoint
DROP TABLE "brand_logo" CASCADE;--> statement-breakpoint
DROP TABLE "brand_font" CASCADE;--> statement-breakpoint
ALTER TABLE "graphic" DROP CONSTRAINT IF EXISTS "graphic_brand_kit_id_brand_kit_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_graphic_brand_kit_id";--> statement-breakpoint
ALTER TABLE "session" DROP COLUMN "active_brand_kit_id";--> statement-breakpoint
ALTER TABLE "graphic" DROP COLUMN "brand_kit_id";--> statement-breakpoint
DROP TYPE "public"."brand_logo_background_removal_method";--> statement-breakpoint
DROP TYPE "public"."brand_logo_format";--> statement-breakpoint
DROP TYPE "public"."brand_logo_variant";--> statement-breakpoint
DROP TYPE "public"."brand_font_fallback";--> statement-breakpoint
DROP TYPE "public"."brand_font_license_type";--> statement-breakpoint
DROP TYPE "public"."brand_font_role";--> statement-breakpoint
DROP TYPE "public"."brand_font_style";