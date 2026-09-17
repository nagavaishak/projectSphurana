import {
  type ConsentFormSubmission,
  consentFormSubmission,
  withPatientScope,
  withSystemScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { getOrgAssetsBucket, upload } from '@borradh-workspace/storage';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { generateConsentPdf } from '../generate-consent-pdf/index.js';
import {
  isPendingFormMoot,
  loadConsentAppointmentState,
} from '../shared/index.js';
import { decodeSignatureImage } from '../shared/signature-image.js';
import {
  type SignConsentFormInput,
  signConsentFormSchema,
} from './sign-consent-form.schema.js';

/** Decoded drawn-signature PNG must stay under 200KB. */
const MAX_SIGNATURE_BYTES = 200_000;

const signConsentFormImpl = async (
  db: DbConnection,
  input: SignConsentFormInput
): Promise<Result<ConsentFormSubmission>> => {
  const parsed = signConsentFormSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { leadId, organizationId, submissionId, fieldData, signedIp } =
    parsed.data;
  const signedByName = parsed.data.signedByName?.trim();

  // The attestation checkbox is a legal requirement, enforced HERE — a client
  // that skips the checkbox and posts anyway is rejected server-side.
  if (parsed.data.attested !== true) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'You must confirm that you have read and agree to this form'
      )
    );
  }

  try {
    // 1. Ownership check under the PATIENT scope: with RLS on, the
    //    patient_self policy makes any row but the patient's own invisible —
    //    the DB itself vouches this submission belongs to the signer.
    //    The appointment's own state is read in the SAME scope, because
    //    whether this form is still signable depends on it (see below).
    const { submission, appointmentState } = await withPatientScope(
      { leadId, organizationId },
      async (tx) => {
        const found = await tx.query.consentFormSubmission.findFirst({
          where: and(
            eq(consentFormSubmission.id, submissionId),
            eq(consentFormSubmission.leadId, leadId),
            eq(consentFormSubmission.organizationId, organizationId)
          ),
        });

        return {
          submission: found,
          appointmentState: found
            ? await loadConsentAppointmentState(tx, {
                appointmentId: found.appointmentId,
                organizationId,
              })
            : undefined,
        };
      },
      { db }
    );

    if (!submission) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Consent form not found')
      );
    }

    if (submission.status === 'completed') {
      return err(
        new FeatureError(
          ErrorCodes.CONFLICT,
          'This consent form has already been signed'
        )
      );
    }

    // The appointment was cancelled (or soft-deleted) while this page was
    // open, or the patient followed an old email link. Signing now would
    // archive a consent record for a visit that never happens — and the
    // hard-delete path purges PENDING forms but is BLOCKED by completed ones,
    // so a stale sign would also wedge the clinic's ability to tidy the slot.
    // Refuse. `list`/`get` already hide it; this is the write-side guard.
    if (isPendingFormMoot(submission.status, appointmentState)) {
      return err(
        new FeatureError(
          ErrorCodes.NOT_FOUND,
          'This appointment is no longer scheduled, so this form no longer needs to be signed'
        )
      );
    }

    if (submission.templateSnapshot.requiresSignature && !signedByName) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'Please type your full name to sign this form'
        )
      );
    }

    // Drawn signature: required whenever the snapshot requires a signature.
    // This is the one place the bytes are materialised, so it is where they
    // are VERIFIED — not merely decoded.
    let signatureBytes: Buffer | null = null;
    if (submission.templateSnapshot.requiresSignature) {
      const dataUrl = parsed.data.signatureImageDataUrl;
      if (!dataUrl) {
        return err(
          new FeatureError(
            ErrorCodes.VALIDATION_ERROR,
            'Please draw your signature to sign this form'
          )
        );
      }
      // The schema's data-URL prefix check and a size cap are not enough:
      // base64 decoding silently drops invalid characters, so any payload
      // decoded to "something" and was stored as image/png. The PDF renderer
      // then sniffs the real bytes, omits the image, and carries on —
      // archiving a consent form that says the patient signed with a blank
      // space where the signature belongs, marked completed, nothing logged.
      // Reject here; the submission stays `pending` so they can sign again.
      const decoded = decodeSignatureImage(dataUrl, MAX_SIGNATURE_BYTES);
      if (!decoded.ok) {
        return err(
          new FeatureError(ErrorCodes.VALIDATION_ERROR, decoded.reason)
        );
      }
      signatureBytes = decoded.bytes;
    }

    // Upload the signature PNG before the completing update so the row and
    // the object land together. A lost concurrent sign leaves at worst an
    // unreferenced object under this submission's own key.
    let signatureImageKey: string | null = null;
    if (signatureBytes) {
      signatureImageKey = `consent-signatures/${organizationId}/${leadId}/${submissionId}.png`;
      await upload({
        bucket: getOrgAssetsBucket(),
        key: signatureImageKey,
        body: signatureBytes,
        contentType: 'image/png',
      });
    }

    // 2. Write under the SYSTEM scope — app_patient holds SELECT only; every
    //    patient-initiated write goes through a system-scoped service (same
    //    split as the patient-auth token writes). The status='pending' guard
    //    makes a concurrent double-sign lose cleanly instead of overwriting.
    const [updated] = await withSystemScope(
      (conn) =>
        conn
          .update(consentFormSubmission)
          .set({
            fieldData,
            signedByName: signedByName ?? null,
            signedAt: new Date(),
            signedIp: signedIp ?? null,
            signatureImageKey,
            status: 'completed',
          })
          .where(
            and(
              eq(consentFormSubmission.id, submissionId),
              eq(consentFormSubmission.leadId, leadId),
              eq(consentFormSubmission.organizationId, organizationId),
              eq(consentFormSubmission.status, 'pending')
            )
          )
          .returning(),
      { db }
    );

    if (!updated) {
      return err(
        new FeatureError(
          ErrorCodes.CONFLICT,
          'This consent form has already been signed'
        )
      );
    }

    // Generate the signed-form PDF fire-and-forget: the sign has legally
    // completed, and a PDF failure must never fail it. The download endpoint
    // regenerates on demand whenever pdf_key is still null.
    try {
      void generateConsentPdf(db, { submissionId, organizationId }).catch(
        (error) => {
          logError('consentForms.signConsentForm.pdf', error, {
            feature: 'consent-forms',
            extra: { submissionId, organizationId },
          });
        }
      );
    } catch (error) {
      logError('consentForms.signConsentForm.pdf', error, {
        feature: 'consent-forms',
        extra: { submissionId, organizationId },
      });
    }

    return ok(updated);
  } catch (error) {
    logError('consentForms.signConsentForm', error, {
      feature: 'consent-forms',
      extra: { submissionId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to sign the consent form'
      )
    );
  }
};

/**
 * Patient-facing: complete + e-sign a consent form. Ownership is verified
 * under `withPatientScope`; the write itself runs under system scope.
 */
export const signConsentForm = (
  db: DbConnection,
  input: SignConsentFormInput
) =>
  trackedResult(
    'consentForms.signConsentForm',
    () => signConsentFormImpl(db, input),
    {
      properties: {
        submissionId: input.submissionId,
        organizationId: input.organizationId,
      },
    }
  );

export type SignConsentFormResult = Awaited<ReturnType<typeof signConsentForm>>;
