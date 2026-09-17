CREATE TABLE "meta_pending_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"encrypted_credentials" text NOT NULL,
	"token_expires_at" timestamp,
	"meta_user_name" text,
	"available_pages" jsonb NOT NULL,
	"available_ad_accounts" jsonb NOT NULL,
	"claimed_by_organization_id" text,
	"claimed_at" timestamp,
	"is_claimed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meta_pending_connection" ADD CONSTRAINT "meta_pending_connection_claimed_by_organization_id_organization_id_fk" FOREIGN KEY ("claimed_by_organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;