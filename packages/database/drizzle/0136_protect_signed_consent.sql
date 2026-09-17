-- ============================================================================
-- Stop a signed consent form being destroyed by an unrelated delete.
-- ============================================================================
-- 0130 made consent_form_submission.appointment_id and .lead_id ON DELETE
-- CASCADE. A completed row is an executed legal instrument — it carries
-- signed_at, signed_ip, signature_image_key and pdf_key — so staff hard-
-- deleting a mis-booked appointment silently destroyed the patient's signed
-- consent for that treatment, with no audit row and orphaned S3 objects.
--
-- Note the asymmetry that made this obvious: template_id was ALREADY
-- RESTRICT (0130), so the blank form was better protected than the signature.
--
-- Both delete paths are soft by default and only hard-delete when the
-- `killswitch-soft-deletes` flag is off — but that flag exists to be flipped,
-- and a cascade is exactly the wrong behaviour to leave armed behind it.
--
-- deleteAppointment and deleteLead now purge PENDING submissions before
-- deleting, so an unsigned form never blocks: only a completed one does, and
-- it surfaces as a CONFLICT naming the consent rather than a raw FK error.
-- ============================================================================

ALTER TABLE "consent_form_submission" DROP CONSTRAINT "consent_form_submission_appointment_id_appointment_id_fk";
--> statement-breakpoint
ALTER TABLE "consent_form_submission" DROP CONSTRAINT "consent_form_submission_lead_id_lead_id_fk";
--> statement-breakpoint
ALTER TABLE "consent_form_submission" ADD CONSTRAINT "consent_form_submission_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_form_submission" ADD CONSTRAINT "consent_form_submission_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE restrict ON UPDATE no action;