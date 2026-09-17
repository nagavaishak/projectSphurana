CREATE TYPE "public"."user_color" AS ENUM('blue', 'green', 'red', 'yellow', 'purple', 'orange');--> statement-breakpoint
CREATE TABLE "org_location_opening_hours_exception" (
	"id" text PRIMARY KEY NOT NULL,
	"location_id" text NOT NULL,
	"date" date NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"from_minutes" integer,
	"to_minutes" integer,
	"note" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "opening_hours_exception_unique" UNIQUE("location_id","date")
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "color" "user_color";--> statement-breakpoint
ALTER TABLE "organization_location" ADD COLUMN "opening_hours" jsonb;--> statement-breakpoint
ALTER TABLE "org_location_opening_hours_exception" ADD CONSTRAINT "org_location_opening_hours_exception_location_id_organization_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."organization_location"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_location_opening_hours_exception" ADD CONSTRAINT "org_location_opening_hours_exception_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_opening_hours_exception_location_date" ON "org_location_opening_hours_exception" USING btree ("location_id","date");