CREATE TABLE "brand_media_embedding" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"meta_ads_page_id" text,
	"platform" text DEFAULT 'facebook' NOT NULL,
	"media_type" text DEFAULT 'image' NOT NULL,
	"post_id" text NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"media_url" text NOT NULL,
	"thumbnail_url" text,
	"permalink" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"format" text DEFAULT 'other' NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"posted_at" timestamp,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_brand_media_embedding_org_post" UNIQUE("organization_id","post_id")
);
--> statement-breakpoint
ALTER TABLE "brand_media_embedding" ADD CONSTRAINT "brand_media_embedding_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_media_embedding" ADD CONSTRAINT "brand_media_embedding_meta_ads_page_id_meta_ads_page_id_fk" FOREIGN KEY ("meta_ads_page_id") REFERENCES "public"."meta_ads_page"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_brand_media_embedding_org_id" ON "brand_media_embedding" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_brand_media_embedding_vector" ON "brand_media_embedding" USING hnsw ("embedding" vector_cosine_ops);