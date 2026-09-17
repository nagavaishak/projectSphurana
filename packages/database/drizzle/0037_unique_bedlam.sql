CREATE TABLE "canva_plugin_api_key" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"key_hash" text NOT NULL,
	"name" text NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "canva_plugin_api_key" ADD CONSTRAINT "canva_plugin_api_key_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_canva_plugin_api_key_user_id" ON "canva_plugin_api_key" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_canva_plugin_api_key_key_hash" ON "canva_plugin_api_key" USING btree ("key_hash");