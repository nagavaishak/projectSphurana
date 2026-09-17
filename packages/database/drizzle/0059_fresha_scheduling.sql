CREATE TYPE "public"."time_off_type" AS ENUM('annual_leave', 'sick_leave', 'training', 'other');--> statement-breakpoint
CREATE TYPE "public"."wage_automation_setting" AS ENUM('workspace_default', 'enabled', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."wage_compensation_type" AS ENUM('none', 'hourly');--> statement-breakpoint
CREATE TYPE "public"."wage_overtime_type" AS ENUM('multiplier', 'hourly_rate');--> statement-breakpoint
CREATE TYPE "public"."wage_regular_hours_per" AS ENUM('day', 'week');--> statement-breakpoint
CREATE TABLE "blocked_time" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"blocked_time_type_id" text,
	"title" text NOT NULL,
	"description" text,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"rrule" text,
	"recurrence_end_date" timestamp with time zone,
	"paid" boolean DEFAULT false NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blocked_time" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "blocked_time_exception" (
	"id" text PRIMARY KEY NOT NULL,
	"blocked_time_id" text NOT NULL,
	"original_start" timestamp with time zone NOT NULL,
	"cancelled" boolean DEFAULT false NOT NULL,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"title" text,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "blocked_time_exception_unique" UNIQUE("blocked_time_id","original_start")
);
--> statement-breakpoint
ALTER TABLE "blocked_time_exception" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "blocked_time_practitioner" (
	"id" text PRIMARY KEY NOT NULL,
	"blocked_time_id" text NOT NULL,
	"practitioner_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "blocked_time_practitioner_unique" UNIQUE("blocked_time_id","practitioner_id")
);
--> statement-breakpoint
ALTER TABLE "blocked_time_practitioner" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "blocked_time_type" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"paid" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "blocked_time_type_org_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
ALTER TABLE "blocked_time_type" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "time_off" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"practitioner_id" text NOT NULL,
	"type" time_off_type DEFAULT 'annual_leave' NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT true NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"rrule" text,
	"recurrence_end_date" timestamp with time zone,
	"description" text,
	"approved" boolean DEFAULT true NOT NULL,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "time_off" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shift" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"practitioner_id" text NOT NULL,
	"location_id" text,
	"day_of_week" integer,
	"date" date,
	"start_minutes" integer,
	"end_minutes" integer,
	"is_off" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shift" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "practitioner_wage_config" (
	"practitioner_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"compensation_type" "wage_compensation_type" DEFAULT 'none' NOT NULL,
	"hourly_rate_cents" integer,
	"overtime_enabled" boolean DEFAULT false NOT NULL,
	"regular_work_hours" real,
	"regular_work_hours_per" "wage_regular_hours_per" DEFAULT 'week' NOT NULL,
	"overtime_type" "wage_overtime_type",
	"overtime_multiplier" real,
	"overtime_hourly_rate_cents" integer,
	"auto_clock_in" "wage_automation_setting" DEFAULT 'workspace_default' NOT NULL,
	"auto_clock_out" "wage_automation_setting" DEFAULT 'workspace_default' NOT NULL,
	"automated_breaks" "wage_automation_setting" DEFAULT 'workspace_default' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "practitioner_wage_config" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_defaults" ADD COLUMN "wage_auto_clock_in" boolean;--> statement-breakpoint
ALTER TABLE "org_defaults" ADD COLUMN "wage_auto_clock_out" boolean;--> statement-breakpoint
ALTER TABLE "org_defaults" ADD COLUMN "wage_automated_breaks" boolean;--> statement-breakpoint
ALTER TABLE "org_defaults" ADD COLUMN "gift_card_preset_amounts" jsonb;--> statement-breakpoint
ALTER TABLE "org_defaults" ADD COLUMN "gift_card_expiry" text;--> statement-breakpoint
ALTER TABLE "blocked_time" ADD CONSTRAINT "blocked_time_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocked_time" ADD CONSTRAINT "blocked_time_blocked_time_type_id_blocked_time_type_id_fk" FOREIGN KEY ("blocked_time_type_id") REFERENCES "public"."blocked_time_type"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocked_time" ADD CONSTRAINT "blocked_time_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocked_time_exception" ADD CONSTRAINT "blocked_time_exception_blocked_time_id_blocked_time_id_fk" FOREIGN KEY ("blocked_time_id") REFERENCES "public"."blocked_time"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocked_time_practitioner" ADD CONSTRAINT "blocked_time_practitioner_blocked_time_id_blocked_time_id_fk" FOREIGN KEY ("blocked_time_id") REFERENCES "public"."blocked_time"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocked_time_practitioner" ADD CONSTRAINT "blocked_time_practitioner_practitioner_id_practitioner_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocked_time_type" ADD CONSTRAINT "blocked_time_type_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_practitioner_id_practitioner_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_practitioner_id_practitioner_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_location_id_organization_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."organization_location"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner_wage_config" ADD CONSTRAINT "practitioner_wage_config_practitioner_id_practitioner_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner_wage_config" ADD CONSTRAINT "practitioner_wage_config_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_blocked_time_org_start" ON "blocked_time" USING btree ("organization_id","start_date");--> statement-breakpoint
CREATE INDEX "idx_blocked_time_org_recurrence_end" ON "blocked_time" USING btree ("organization_id","recurrence_end_date");--> statement-breakpoint
CREATE INDEX "idx_blocked_time_practitioner_practitioner_id" ON "blocked_time_practitioner" USING btree ("practitioner_id");--> statement-breakpoint
CREATE INDEX "idx_time_off_org_practitioner_start" ON "time_off" USING btree ("organization_id","practitioner_id","start_date");--> statement-breakpoint
CREATE INDEX "idx_shift_org_practitioner_dow" ON "shift" USING btree ("organization_id","practitioner_id","day_of_week");--> statement-breakpoint
CREATE INDEX "idx_shift_org_practitioner_date" ON "shift" USING btree ("organization_id","practitioner_id","date");--> statement-breakpoint
CREATE INDEX "idx_practitioner_wage_config_org_id" ON "practitioner_wage_config" USING btree ("organization_id");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "blocked_time" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "child_org_isolation" ON "blocked_time_exception" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM blocked_time p
    WHERE p.id = blocked_time_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM blocked_time p
    WHERE p.id = blocked_time_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
CREATE POLICY "join_org_isolation" ON "blocked_time_practitioner" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM blocked_time p
    WHERE p.id = blocked_time_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM blocked_time p
    WHERE p.id = blocked_time_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "blocked_time_type" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "time_off" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "shift" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "practitioner_wage_config" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));