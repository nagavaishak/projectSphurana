import { consentFormSubmission } from '@borradh-workspace/database';
import { and, eq } from 'drizzle-orm';
import type { DbConnection } from '../../../shared/index.js';

/**
 * Guard the hard-delete paths against destroying an executed consent form.
 *
 * `consent_form_submission.appointment_id` and `.lead_id` are ON DELETE
 * RESTRICT (0136), because a completed row carries `signed_at`, `signed_ip`,
 * the signature image key and the PDF key — it is the clinic's evidence that
 * the patient was told the risks and agreed. Cascading it away as a side
 * effect of tidying a diary is not a delete anyone intended.
 *
 * RESTRICT alone would be too blunt: it would also block deleting an
 * appointment whose forms were merely SENT and never signed, which is the
 * common case for a mis-booked slot. So:
 *
 *   pending   → deleted here. Nothing was executed; the form only ever
 *               referred to an appointment that is about to stop existing.
 *   completed → left in place, and reported back so the caller can refuse
 *               the delete with a CONFLICT that names the problem, rather
 *               than letting the FK raise a bare 500.
 *
 * Call this INSIDE the caller's transaction, before the delete.
 */
export async function releasePendingConsentForms(
  db: DbConnection,
  scope: { appointmentId: string } | { leadId: string }
): Promise<{ signedCount: number }> {
  const match =
    'appointmentId' in scope
      ? eq(consentFormSubmission.appointmentId, scope.appointmentId)
      : eq(consentFormSubmission.leadId, scope.leadId);

  await db
    .delete(consentFormSubmission)
    .where(and(match, eq(consentFormSubmission.status, 'pending')));

  const remaining = await db
    .select({ id: consentFormSubmission.id })
    .from(consentFormSubmission)
    .where(and(match, eq(consentFormSubmission.status, 'completed')));

  return { signedCount: remaining.length };
}

/** Message shared by both delete paths, so the wording stays consistent. */
export const SIGNED_CONSENT_BLOCKS_DELETE =
  'This has a signed consent form attached and cannot be deleted. Signed ' +
  'consent is retained as a clinical record — cancel or archive instead.';
