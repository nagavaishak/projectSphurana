-- GDPR erasure (one-time data migration). Face grouping was populated by AWS
-- Rekognition biometric identification, which is removed in this change. Every
-- face_group / face_group_asset row was derived from biometric processing that
-- had no lawful basis, so all rows are deleted here — the database leg of the
-- erasure. The AWS Rekognition collections and the S3 face-crop thumbnails are
-- purged out-of-band (see scripts/purge-rekognition-collections.mjs and the
-- s3://.../face-thumbnails/ cleanup). Going forward the tables are repopulated
-- only by manual before/after pairing.
DELETE FROM "face_group_asset";--> statement-breakpoint
DELETE FROM "face_group";--> statement-breakpoint
ALTER TABLE "face_detection" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY "org_isolation" ON "face_detection" CASCADE;--> statement-breakpoint
DROP TABLE "face_detection" CASCADE;--> statement-breakpoint
ALTER TABLE "face_group" DROP CONSTRAINT "face_group_practitioner_id_practitioner_id_fk";
--> statement-breakpoint
ALTER TABLE "asset_upload_batch" DROP COLUMN "face_detection_completed_count";--> statement-breakpoint
ALTER TABLE "face_group" DROP COLUMN "rekognition_face_id";--> statement-breakpoint
ALTER TABLE "face_group" DROP COLUMN "thumbnail_url";--> statement-breakpoint
ALTER TABLE "face_group" DROP COLUMN "practitioner_id";--> statement-breakpoint
ALTER TABLE "face_group" DROP COLUMN "is_excluded";--> statement-breakpoint
ALTER TABLE "face_group" DROP COLUMN "exclusion_reason";--> statement-breakpoint
ALTER TABLE "face_group" DROP COLUMN "total_detections";--> statement-breakpoint
ALTER TABLE "face_group" DROP COLUMN "batch_count";--> statement-breakpoint
DROP TYPE "public"."face_detection_status";--> statement-breakpoint
DROP TYPE "public"."face_group_exclusion_reason";