CREATE TABLE "audio_asset" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"hash" text NOT NULL,
	"url" text,
	"duration_ms" integer,
	"payload" text,
	"organization_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video" ADD COLUMN "schema_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "video" ADD COLUMN "render_doc" jsonb;--> statement-breakpoint
ALTER TABLE "video" ADD COLUMN "synthesis_seed" integer;--> statement-breakpoint
ALTER TABLE "org_defaults" ADD COLUMN "video_template_engine_v2" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "audio_asset" ADD CONSTRAINT "audio_asset_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audio_asset_org_id" ON "audio_asset" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_audio_asset_lookup" ON "audio_asset" USING btree ("organization_id","kind","hash");