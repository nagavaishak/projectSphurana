CREATE TYPE "public"."appointment_resource_source" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."resource_category_kind" AS ENUM('room', 'equipment', 'other');--> statement-breakpoint
CREATE TABLE "appointment_resource" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"appointment_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone NOT NULL,
	"turnaround_minutes" integer DEFAULT 0 NOT NULL,
	"source" "appointment_resource_source" DEFAULT 'auto' NOT NULL,
	"allow_overlap" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_resource_unique" UNIQUE("appointment_id","resource_id")
);
--> statement-breakpoint
ALTER TABLE "appointment_resource" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "resource" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"category_id" text NOT NULL,
	"location_id" text,
	"name" text NOT NULL,
	"description" text,
	"color" "user_color",
	"photo" text,
	"capacity" integer DEFAULT 1 NOT NULL,
	"specs" jsonb,
	"working_hours" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "resource" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "resource_category" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" "resource_category_kind" DEFAULT 'room' NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "resource_category" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "service_resource_eligibility" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"service_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "service_resource_eligibility_unique" UNIQUE("service_id","resource_id")
);
--> statement-breakpoint
ALTER TABLE "service_resource_eligibility" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "service_resource_requirement" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"service_id" text NOT NULL,
	"category_id" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "service_resource_requirement_unique" UNIQUE("service_id","category_id")
);
--> statement-breakpoint
ALTER TABLE "service_resource_requirement" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_service" ADD COLUMN "turnaround_minutes" integer;--> statement-breakpoint
ALTER TABLE "org_defaults" ADD COLUMN "resource_assignment_mode" text;--> statement-breakpoint
ALTER TABLE "appointment_resource" ADD CONSTRAINT "appointment_resource_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_resource" ADD CONSTRAINT "appointment_resource_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_resource" ADD CONSTRAINT "appointment_resource_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_category_id_resource_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."resource_category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_location_id_organization_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."organization_location"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_category" ADD CONSTRAINT "resource_category_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_resource_eligibility" ADD CONSTRAINT "service_resource_eligibility_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_resource_eligibility" ADD CONSTRAINT "service_resource_eligibility_service_id_organization_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."organization_service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_resource_eligibility" ADD CONSTRAINT "service_resource_eligibility_resource_id_resource_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resource"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_resource_requirement" ADD CONSTRAINT "service_resource_requirement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_resource_requirement" ADD CONSTRAINT "service_resource_requirement_service_id_organization_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."organization_service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_resource_requirement" ADD CONSTRAINT "service_resource_requirement_category_id_resource_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."resource_category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_appointment_resource_appointment" ON "appointment_resource" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "idx_appointment_resource_window" ON "appointment_resource" USING btree ("resource_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "idx_resource_org_category" ON "resource" USING btree ("organization_id","category_id");--> statement-breakpoint
CREATE INDEX "idx_resource_location" ON "resource" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "resource_category_org_name_unique" ON "resource_category" USING btree ("organization_id","name") WHERE "resource_category"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_resource_category_org" ON "resource_category" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_service_resource_eligibility_service" ON "service_resource_eligibility" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "idx_service_resource_eligibility_resource" ON "service_resource_eligibility" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "idx_service_resource_requirement_service" ON "service_resource_requirement" USING btree ("service_id");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "appointment_resource" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "resource" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "resource_category" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "service_resource_eligibility" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "service_resource_requirement" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint

-- ============================================================================
-- HAND-WRITTEN SECTION — resource_no_overlap exclusion constraint
-- ============================================================================
-- The DB backstop for room double-booking, mirroring `appointment_no_overlap`
-- (0073). The application layer checks availability before allocating, but a
-- check-then-insert is a race: two concurrent online bookings can both observe
-- "Room 2 is free" and both insert. This constraint makes that physically
-- impossible for capacity-1 resources.
--
-- WHY THE `allow_overlap = false` PREDICATE:
--   1. Staff force-overrides — the front desk may knowingly double-book a room
--      (Phorest's model: warn, don't block). Those rows opt out.
--   2. capacity > 1 resources (a double treatment room, a 4-station nail bar).
--      A plain exclusion constraint cannot count to N, so those allocations opt
--      out here and capacity is enforced in the service layer instead.
--
-- `btree_gist` is required for the `resource_id WITH =` operator; it was
-- installed by 0073 for appointment_no_overlap. CREATE EXTENSION IF NOT EXISTS
-- is idempotent and makes this migration self-contained (a fresh DB replaying
-- from 0000 gets it either way).
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint

ALTER TABLE "appointment_resource"
  ADD CONSTRAINT "resource_no_overlap"
  EXCLUDE USING gist (
    "resource_id" WITH =,
    tstzrange("start_date", "end_date") WITH &&
  )
  WHERE ("allow_overlap" = false);--> statement-breakpoint

-- ============================================================================
-- HAND-WRITTEN SECTION — app_public grants
-- ============================================================================
-- `app_public` is the role behind the UNAUTHENTICATED booking widget. It must
-- be able to COMPUTE resource gating (otherwise online bookings would silently
-- stop being gated and rooms would double-book), and INSERT its own allocation
-- when a booking is created.
--
-- ⚠️  FAILURE MODE: a missing grant surfaces as "permission denied", which the
-- booking service swallows into an EMPTY-SLOTS result rather than a visible
-- error — or worse, into "no requirements found" => gating silently disabled.
-- Keep these grants and the resolver's explicit column lists IN STEP.
--
-- Idempotent: GRANT of a held privilege is a no-op. Safe to re-run.

-- resource — withheld: name, description, photo, specs (clinic-internal detail;
-- "Lumenis M22" / "Room 2 - back corridor" is not public information). Only the
-- fields needed to answer "is an eligible resource free at 14:00?" are granted.
--
-- ⚠️  `sort_order` IS GRANTED, and it must be. Postgres column privileges cover
-- EVERY referenced column, including ones that appear only in ORDER BY. The
-- engine picks a room deterministically (least-allocated, ties broken by
-- sort_order) so auto-assignment is reproducible; ordering by an ungranted
-- column would raise "permission denied" for the public booking widget, which
-- these services swallow into an EMPTY-SLOTS result — gating silently off.
-- `name` stays withheld precisely because it is NOT needed for ordering once
-- sort_order is available; ties beyond sort_order break on `id`.
GRANT SELECT (
  id,
  organization_id,
  category_id,
  location_id,
  capacity,
  working_hours,
  sort_order,
  is_active,
  deleted_at
) ON resource TO app_public;--> statement-breakpoint

-- Requirement + eligibility are pure scheduling join data (ids only) — nothing
-- personal or commercially sensitive, so table-level SELECT is appropriate
-- (same call as shift / blocked_time_practitioner in 0090).
GRANT SELECT ON service_resource_requirement TO app_public;--> statement-breakpoint
GRANT SELECT ON service_resource_eligibility TO app_public;--> statement-breakpoint
GRANT SELECT ON resource_category TO app_public;--> statement-breakpoint

-- appointment_resource — the busy ranges. Withheld: nothing sensitive exists on
-- this table (it is ids + times), but the column list is kept explicit so a
-- future column defaults to NOT being public.
GRANT SELECT (
  id,
  organization_id,
  appointment_id,
  resource_id,
  start_date,
  end_date,
  turnaround_minutes,
  allow_overlap
) ON appointment_resource TO app_public;--> statement-breakpoint

-- The public booking flow creates the appointment AND its allocations in one
-- transaction, so it needs INSERT. RLS (org_isolation WITH CHECK) still pins
-- every inserted row to the org scope set for the transaction.
GRANT INSERT ON appointment_resource TO app_public;
