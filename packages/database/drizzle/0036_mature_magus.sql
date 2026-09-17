ALTER TABLE "canva_integration" DROP CONSTRAINT "unique_org_canva";--> statement-breakpoint
ALTER TABLE "canva_integration" DROP CONSTRAINT "canva_integration_organization_id_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "canva_integration" DROP CONSTRAINT "canva_integration_connected_by_id_user_id_fk";
--> statement-breakpoint
DROP INDEX "idx_canva_integration_connected_by_id";--> statement-breakpoint
ALTER TABLE "canva_integration" ADD COLUMN "user_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "canva_integration" ADD CONSTRAINT "canva_integration_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_canva_integration_user_id" ON "canva_integration" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "canva_integration" DROP COLUMN "organization_id";--> statement-breakpoint
ALTER TABLE "canva_integration" DROP COLUMN "connected_by_id";--> statement-breakpoint
ALTER TABLE "canva_integration" ADD CONSTRAINT "unique_user_canva" UNIQUE("user_id");