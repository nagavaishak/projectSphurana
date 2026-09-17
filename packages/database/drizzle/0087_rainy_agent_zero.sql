ALTER TABLE "organization_location" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "organization_location" ADD COLUMN "about" text;--> statement-breakpoint
ALTER TABLE "organization_location" ADD COLUMN "amenities" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_photo" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "organization_photo" ADD CONSTRAINT "organization_photo_location_id_organization_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."organization_location"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_organization_photo_location_sort" ON "organization_photo" USING btree ("location_id","sort_order");--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "about";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "amenities";--> statement-breakpoint
ALTER TABLE "organization_location" ADD CONSTRAINT "organization_location_slug_unique" UNIQUE("slug");