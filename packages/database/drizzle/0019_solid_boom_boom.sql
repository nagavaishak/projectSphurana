CREATE TABLE "practitioner_unavailability" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"practitioner_id" text,
	"title" text NOT NULL,
	"description" text,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"rrule" text,
	"recurrence_end_date" timestamp with time zone,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practitioner_unavailability_exception" (
	"id" text PRIMARY KEY NOT NULL,
	"unavailability_id" text NOT NULL,
	"original_start" timestamp with time zone NOT NULL,
	"cancelled" boolean DEFAULT false NOT NULL,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"title" text,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unavailability_exception_unique" UNIQUE("unavailability_id","original_start")
);
--> statement-breakpoint
ALTER TABLE "practitioner_unavailability" ADD CONSTRAINT "practitioner_unavailability_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner_unavailability" ADD CONSTRAINT "practitioner_unavailability_practitioner_id_practitioner_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner_unavailability" ADD CONSTRAINT "practitioner_unavailability_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner_unavailability_exception" ADD CONSTRAINT "practitioner_unavailability_exception_unavailability_id_practitioner_unavailability_id_fk" FOREIGN KEY ("unavailability_id") REFERENCES "public"."practitioner_unavailability"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_unavailability_org_practitioner_start" ON "practitioner_unavailability" USING btree ("organization_id","practitioner_id","start_date");--> statement-breakpoint
CREATE INDEX "idx_unavailability_org_recurrence_end" ON "practitioner_unavailability" USING btree ("organization_id","recurrence_end_date");--> statement-breakpoint
CREATE INDEX "idx_unavailability_exception_unavailability_id" ON "practitioner_unavailability_exception" USING btree ("unavailability_id");