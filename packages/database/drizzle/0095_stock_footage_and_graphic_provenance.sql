ALTER TYPE "public"."asset_source" ADD VALUE 'stock';--> statement-breakpoint
CREATE TABLE "stock_clip" (
	"id" text PRIMARY KEY NOT NULL,
	"vertical" text NOT NULL,
	"content_type" text NOT NULL,
	"is_generic" boolean DEFAULT false NOT NULL,
	"description" text NOT NULL,
	"media_type" text DEFAULT 'video' NOT NULL,
	"blob_url" text NOT NULL,
	"transcoded_blob_url" text,
	"duration_sec" real,
	"width" integer,
	"height" integer,
	"embedding" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_stock_clip" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_service_id" text NOT NULL,
	"stock_clip_id" text NOT NULL,
	"rank" integer DEFAULT 0 NOT NULL,
	"score" real,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "service_stock_clip_unique" UNIQUE("organization_service_id","stock_clip_id")
);
--> statement-breakpoint
ALTER TABLE "service_stock_clip" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "stock_clip_id" text;--> statement-breakpoint
ALTER TABLE "graphic" ADD COLUMN "offer_id" text;--> statement-breakpoint
ALTER TABLE "graphic" ADD COLUMN "source_asset_ids" text[];--> statement-breakpoint
ALTER TABLE "graphic" ADD COLUMN "allow_ai_images" boolean;--> statement-breakpoint
ALTER TABLE "service_stock_clip" ADD CONSTRAINT "service_stock_clip_organization_service_id_organization_service_id_fk" FOREIGN KEY ("organization_service_id") REFERENCES "public"."organization_service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_stock_clip" ADD CONSTRAINT "service_stock_clip_stock_clip_id_stock_clip_id_fk" FOREIGN KEY ("stock_clip_id") REFERENCES "public"."stock_clip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_stock_clip_vertical" ON "stock_clip" USING btree ("vertical");--> statement-breakpoint
CREATE INDEX "idx_stock_clip_content_type" ON "stock_clip" USING btree ("content_type");--> statement-breakpoint
CREATE INDEX "idx_service_stock_clip_service" ON "service_stock_clip" USING btree ("organization_service_id");--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_stock_clip_id_stock_clip_id_fk" FOREIGN KEY ("stock_clip_id") REFERENCES "public"."stock_clip"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_asset_stock_clip_id" ON "asset" USING btree ("stock_clip_id");--> statement-breakpoint
CREATE POLICY "child_org_isolation" ON "service_stock_clip" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM organization_service p
    WHERE p.id = service_stock_clip.organization_service_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM organization_service p
    WHERE p.id = service_stock_clip.organization_service_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));