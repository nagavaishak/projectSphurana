-- pgvector must exist before any vector(...) column. Idempotent; prod and
-- the baseline already rely on it (see 0000_baseline.sql), but a fresh CI
-- database has no extensions.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."clip_agent_source" AS ENUM('curated', 'inherited', 'unconfirmed');--> statement-breakpoint
CREATE TYPE "public"."service_spec_source" AS ENUM('declared', 'inferred_from_name', 'unknown');--> statement-breakpoint
CREATE TABLE "technique" (
	"slug" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"visual_signature" text,
	"is_procedural" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treatment_agent" (
	"slug" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"technique_slug" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"requires_exact_match" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_agent" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_service_id" text NOT NULL,
	"agent_slug" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'inferred_from_name' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "service_agent_unique" UNIQUE("organization_service_id","agent_slug")
);
--> statement-breakpoint
ALTER TABLE "service_agent" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_clip" ALTER COLUMN "vertical" DROP NOT NULL;--> statement-breakpoint
-- jsonb -> vector has no implicit cast, so ALTER ... SET DATA TYPE fails even
-- on an empty table. stock_clip has zero rows in production (the matcher has
-- never run) and the jsonb embedding was never populated, so drop/re-add is
-- lossless and avoids needing a USING clause.
ALTER TABLE "stock_clip" DROP COLUMN "embedding";--> statement-breakpoint
ALTER TABLE "stock_clip" ADD COLUMN "embedding" vector(1536);--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "agent_slug" text;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "technique_slug" text;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "regions" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "agent_source" "clip_agent_source" DEFAULT 'unconfirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "visual_description" text;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "embedding" vector(1536);--> statement-breakpoint
ALTER TABLE "stock_clip" ADD COLUMN "agent_slug" text;--> statement-breakpoint
ALTER TABLE "stock_clip" ADD COLUMN "technique_slug" text;--> statement-breakpoint
ALTER TABLE "stock_clip" ADD COLUMN "regions" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_clip" ADD COLUMN "agent_source" "clip_agent_source" DEFAULT 'curated' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_clip" ADD COLUMN "visual_description" text;--> statement-breakpoint
ALTER TABLE "organization_service" ADD COLUMN "regions" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_service" ADD COLUMN "spec_source" "service_spec_source" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_service" ADD COLUMN "expected_shot" text;--> statement-breakpoint
ALTER TABLE "treatment_agent" ADD CONSTRAINT "treatment_agent_technique_slug_technique_slug_fk" FOREIGN KEY ("technique_slug") REFERENCES "public"."technique"("slug") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_agent" ADD CONSTRAINT "service_agent_organization_service_id_organization_service_id_fk" FOREIGN KEY ("organization_service_id") REFERENCES "public"."organization_service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_agent" ADD CONSTRAINT "service_agent_agent_slug_treatment_agent_slug_fk" FOREIGN KEY ("agent_slug") REFERENCES "public"."treatment_agent"("slug") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_treatment_agent_technique" ON "treatment_agent" USING btree ("technique_slug");--> statement-breakpoint
CREATE INDEX "idx_service_agent_service" ON "service_agent" USING btree ("organization_service_id");--> statement-breakpoint
CREATE INDEX "idx_service_agent_agent" ON "service_agent" USING btree ("agent_slug");--> statement-breakpoint
CREATE INDEX "idx_stock_clip_technique" ON "stock_clip" USING btree ("technique_slug");--> statement-breakpoint
CREATE INDEX "idx_stock_clip_agent" ON "stock_clip" USING btree ("agent_slug");--> statement-breakpoint
CREATE POLICY "child_org_isolation" ON "service_agent" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM organization_service p
    WHERE p.id = service_agent.organization_service_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM organization_service p
    WHERE p.id = service_agent.organization_service_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));