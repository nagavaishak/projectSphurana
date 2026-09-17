CREATE TABLE "microsite" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"slug" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"theme" jsonb NOT NULL,
	"published_revision_id" text,
	"draft_revision_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "microsite_organization_id_unique" UNIQUE("organization_id"),
	CONSTRAINT "microsite_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "microsite" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "microsite_conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"microsite_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text,
	"title" text,
	"last_message_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "microsite_conversation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "microsite_domain" (
	"id" text PRIMARY KEY NOT NULL,
	"microsite_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"domain" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending_dns' NOT NULL,
	"verification" jsonb,
	"last_checked_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "microsite_domain_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
ALTER TABLE "microsite_domain" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "microsite_message" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"tool_calls" jsonb,
	"revision_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "microsite_message" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "microsite_page" (
	"id" text PRIMARY KEY NOT NULL,
	"microsite_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"path" text NOT NULL,
	"title" text NOT NULL,
	"seo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_microsite_page_site_path" UNIQUE("microsite_id","path")
);
--> statement-breakpoint
ALTER TABLE "microsite_page" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "microsite_revision" (
	"id" text PRIMARY KEY NOT NULL,
	"microsite_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"label" text,
	"pages" jsonb NOT NULL,
	"theme" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"prompt_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "microsite_revision" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "microsite_id" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "utm_source" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "utm_medium" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "utm_campaign" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "utm_content" text;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "utm_term" text;--> statement-breakpoint
ALTER TABLE "microsite" ADD CONSTRAINT "microsite_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "microsite_conversation" ADD CONSTRAINT "microsite_conversation_microsite_id_microsite_id_fk" FOREIGN KEY ("microsite_id") REFERENCES "public"."microsite"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "microsite_conversation" ADD CONSTRAINT "microsite_conversation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "microsite_conversation" ADD CONSTRAINT "microsite_conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "microsite_domain" ADD CONSTRAINT "microsite_domain_microsite_id_microsite_id_fk" FOREIGN KEY ("microsite_id") REFERENCES "public"."microsite"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "microsite_domain" ADD CONSTRAINT "microsite_domain_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "microsite_message" ADD CONSTRAINT "microsite_message_conversation_id_microsite_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."microsite_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "microsite_message" ADD CONSTRAINT "microsite_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "microsite_message" ADD CONSTRAINT "microsite_message_revision_id_microsite_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."microsite_revision"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "microsite_page" ADD CONSTRAINT "microsite_page_microsite_id_microsite_id_fk" FOREIGN KEY ("microsite_id") REFERENCES "public"."microsite"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "microsite_page" ADD CONSTRAINT "microsite_page_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "microsite_revision" ADD CONSTRAINT "microsite_revision_microsite_id_microsite_id_fk" FOREIGN KEY ("microsite_id") REFERENCES "public"."microsite"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "microsite_revision" ADD CONSTRAINT "microsite_revision_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_microsite_conversation_org_id" ON "microsite_conversation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_microsite_conversation_site_last_message" ON "microsite_conversation" USING btree ("microsite_id","last_message_at");--> statement-breakpoint
CREATE INDEX "idx_microsite_domain_org_id" ON "microsite_domain" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_microsite_domain_microsite_id" ON "microsite_domain" USING btree ("microsite_id");--> statement-breakpoint
CREATE INDEX "idx_microsite_domain_status" ON "microsite_domain" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_microsite_message_org_id" ON "microsite_message" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_microsite_message_conversation_created" ON "microsite_message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_microsite_page_org_id" ON "microsite_page" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_microsite_page_microsite_id" ON "microsite_page" USING btree ("microsite_id");--> statement-breakpoint
CREATE INDEX "idx_microsite_revision_org_id" ON "microsite_revision" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_microsite_revision_site_created" ON "microsite_revision" USING btree ("microsite_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_lead_utm_campaign" ON "lead" USING btree ("organization_id","utm_campaign");--> statement-breakpoint
CREATE INDEX "idx_lead_microsite_id" ON "lead" USING btree ("microsite_id");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "microsite" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "microsite_conversation" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "microsite_domain" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "microsite_message" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "microsite_page" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "microsite_revision" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));