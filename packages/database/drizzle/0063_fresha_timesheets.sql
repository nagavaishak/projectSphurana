CREATE TYPE "public"."time_entry_source" AS ENUM('manual', 'auto');--> statement-breakpoint
CREATE TYPE "public"."time_entry_status" AS ENUM('open', 'completed', 'approved');--> statement-breakpoint
CREATE TABLE "time_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"practitioner_id" text NOT NULL,
	"clock_in" timestamp with time zone NOT NULL,
	"clock_out" timestamp with time zone,
	"source" time_entry_source DEFAULT 'manual' NOT NULL,
	"status" time_entry_status DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time_entry" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time_entry_break" (
	"id" text PRIMARY KEY NOT NULL,
	"time_entry_id" text NOT NULL,
	"break_start" timestamp with time zone NOT NULL,
	"break_end" timestamp with time zone,
	"source" time_entry_source DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time_entry_break" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry" ADD CONSTRAINT "time_entry_practitioner_id_practitioner_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entry_break" ADD CONSTRAINT "time_entry_break_time_entry_id_time_entry_id_fk" FOREIGN KEY ("time_entry_id") REFERENCES "public"."time_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_time_entry_org_practitioner_clock_in" ON "time_entry" USING btree ("organization_id","practitioner_id","clock_in");--> statement-breakpoint
CREATE INDEX "idx_time_entry_break_entry_id" ON "time_entry_break" USING btree ("time_entry_id");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "time_entry" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "child_org_isolation" ON "time_entry_break" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM time_entry p
    WHERE p.id = time_entry_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM time_entry p
    WHERE p.id = time_entry_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));