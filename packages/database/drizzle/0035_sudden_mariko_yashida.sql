CREATE TABLE "canva_integration" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"connected_by_id" text NOT NULL,
	"encrypted_credentials" text NOT NULL,
	"access_token_expires_at" timestamp NOT NULL,
	"scopes" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_org_canva" UNIQUE("organization_id")
);
--> statement-breakpoint
ALTER TABLE "canva_integration" ADD CONSTRAINT "canva_integration_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canva_integration" ADD CONSTRAINT "canva_integration_connected_by_id_user_id_fk" FOREIGN KEY ("connected_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_canva_integration_connected_by_id" ON "canva_integration" USING btree ("connected_by_id");