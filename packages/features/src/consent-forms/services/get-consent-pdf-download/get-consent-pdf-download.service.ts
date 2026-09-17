import {
  type ConsentFormSubmission,
  consentFormSubmission,
  withOrgScope,
  withPatientScope,
  withSystemScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  attachmentDisposition,
  getOrgAssetsBucket,
  getPresignedDownloadUrl,
} from '@borradh-workspace/storage';
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
  type GetConsentPdfDownloadForPatientInput,
  type GetConsentPdfDownloadForStaffInput,
  getConsentPdfDownloadForPatientSchema,
  getConsentPdfDownloadForStaffSchema,
} from './get-consent-pdf-download.schema.js';

/** Presigned GETs are short-lived: enough to open/save, useless if leaked. */
const DOWNLOAD_URL_TTL_SECONDS = 300;

/**
 * How many times a failing compose is retried across ALL download requests
 * before the endpoint stops trying. Small on purpose: a compose that failed
 * three times is not going to succeed on the fourth, and each attempt is a
 * full document render.
 */
const MAX_PDF_ATTEMPTS = 3;

export interface ConsentPdfDownload {
  url: string;
  expiresIn: number;
}

/**
 * Common tail: the submission is already authorised (scoped fetch by the
 * caller). Regenerate the PDF when `pdf_key` is still null (the sign-time
 * generation is fire-and-forget and allowed to fail), then presign.
 */
const buildDownload = async (
  db: DbConnection,
  submission: ConsentFormSubmission
): Promise<Result<ConsentPdfDownload>> => {
  if (submission.status !== 'completed') {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'This consent form has not been signed yet'
      )
    );
  }

  let pdfKey = submission.pdfKey;
  if (!pdfKey) {
    // Give up after a few failures instead of recomposing on every request.
    //
    // Generation at sign time is fire-and-forget and this endpoint regenerates
    // whenever `pdf_key` is null, so a compose that fails DETERMINISTICALLY —
    // an oversized body, a pdf-lib throw, a logo that times out — re-ran the
    // entire compose on every download, from both the patient and the staff
    // endpoint, with no backoff and no record of it having happened. The only
    // symptom was repeated 500s, and the work was unbounded.
    if (submission.pdfGenerationAttempts >= MAX_PDF_ATTEMPTS) {
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'This consent form could not be prepared for download. The clinic has been notified.'
        )
      );
    }

    const generated = await generateConsentPdf(db, {
      submissionId: submission.id,
      organizationId: submission.organizationId,
    });
    if (!generated.success) {
      // Record the failure so the next request can stop. Best-effort: a
      // failed counter update must not mask the generation error itself.
      await withSystemScope(
        (conn) =>
          conn
            .update(consentFormSubmission)
            .set({
              pdfGenerationAttempts: submission.pdfGenerationAttempts + 1,
            })
            .where(eq(consentFormSubmission.id, submission.id)),
        { db }
      ).catch(() => undefined);

      // trackedResult serialises errors to a plain shape — rewrap.
      return err(
        new FeatureError(
          generated.error.code,
          generated.error.message,
          generated.error.details
        )
      );
    }
    pdfKey = generated.data.pdfKey;

    // Succeeded — clear the counter, so a transient failure never permanently
    // condemns a form.
    if (submission.pdfGenerationAttempts > 0) {
      await withSystemScope(
        (conn) =>
          conn
            .update(consentFormSubmission)
            .set({ pdfGenerationAttempts: 0 })
            .where(eq(consentFormSubmission.id, submission.id)),
        { db }
      ).catch(() => undefined);
    }
  }

  // Presign only a key that sits under THIS submission's own prefix.
  //
  // Ownership is already proven — the row was fetched scoped to org and lead —
  // so this is defence in depth, and the sibling patient-documents path has
  // had it from the start. It matters because `pdf_key` is the ONLY thing
  // deciding which object gets signed: any future writer of that column, a
  // legacy value or a bad backfill turns this endpoint into an
  // arbitrary-object read using our own credentials. Anchored with
  // `startsWith` on a fully-qualified prefix, so `../` cannot climb out.
  //
  // `startsWith` alone is not quite enough: `consent-pdfs/<org>/<lead>/../../x`
  // satisfies it. S3 keys are opaque strings with no server-side path
  // resolution, so today that resolves to nothing rather than escaping — but
  // that is a property of S3, not of this check, and it would stop holding
  // behind a CDN or any client that normalises. Reject the segment outright
  // rather than depending on a downstream detail.
  const requiredPrefix = `consent-pdfs/${submission.organizationId}/${submission.leadId}/`;
  if (!pdfKey.startsWith(requiredPrefix) || pdfKey.includes('..')) {
    logError(
      'consentForms.getConsentPdfDownload.keyOutsidePrefix',
      new Error('pdf_key does not sit under the submission prefix'),
      {
        feature: 'consent-forms',
        extra: { submissionId: submission.id, pdfKey },
      }
    );
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Consent form PDF not found')
    );
  }

  try {
    // Signed consent is served as a download, not rendered inline: even though
    // the PDF is server-generated, forcing `attachment` + `application/pdf`
    // keeps a presigned URL from ever being coerced into rendering something
    // executable, and gives the saved file a sensible name.
    const url = await getPresignedDownloadUrl({
      bucket: getOrgAssetsBucket(),
      key: pdfKey,
      expiresIn: DOWNLOAD_URL_TTL_SECONDS,
      responseContentType: 'application/pdf',
      responseContentDisposition: attachmentDisposition(
        `consent-form-${submission.id}.pdf`
      ),
    });
    return ok({ url, expiresIn: DOWNLOAD_URL_TTL_SECONDS });
  } catch (error) {
    logError('consentForms.getConsentPdfDownload', error, {
      feature: 'consent-forms',
      extra: {
        submissionId: submission.id,
        organizationId: submission.organizationId,
      },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Download unavailable')
    );
  }
};

/**
 * Portal variant: ownership proven under `withPatientScope` — the
 * patient-self RLS policy makes any other patient's row invisible, so a
 * guessed submissionId resolves to NOT_FOUND before any URL is minted.
 */
export const getConsentPdfDownloadForPatient = (
  db: DbConnection,
  input: GetConsentPdfDownloadForPatientInput
) =>
  trackedResult(
    'consentForms.getConsentPdfDownloadForPatient',
    async () => {
      const parsed = getConsentPdfDownloadForPatientSchema.safeParse(input);
      if (!parsed.success) {
        return err(
          new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
            issues: parsed.error.issues,
          })
        );
      }
      const submission = await withPatientScope(
        {
          leadId: parsed.data.leadId,
          organizationId: parsed.data.organizationId,
        },
        (tx) =>
          tx.query.consentFormSubmission.findFirst({
            where: and(
              eq(consentFormSubmission.id, parsed.data.submissionId),
              eq(consentFormSubmission.leadId, parsed.data.leadId),
              eq(
                consentFormSubmission.organizationId,
                parsed.data.organizationId
              )
            ),
          }),
        { db }
      );
      if (!submission) {
        return err(
          new FeatureError(ErrorCodes.NOT_FOUND, 'Consent form not found')
        );
      }
      return buildDownload(db, submission);
    },
    {
      properties: { submissionId: input.submissionId },
      internalErrorsOnly: true,
    }
  );

/** Staff variant: org-scoped; any staff member of the org may download. */
export const getConsentPdfDownloadForStaff = (
  db: DbConnection,
  input: GetConsentPdfDownloadForStaffInput
) =>
  trackedResult(
    'consentForms.getConsentPdfDownloadForStaff',
    async () => {
      const parsed = getConsentPdfDownloadForStaffSchema.safeParse(input);
      if (!parsed.success) {
        return err(
          new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
            issues: parsed.error.issues,
          })
        );
      }
      const submission = await withOrgScope(
        (tx) =>
          tx.query.consentFormSubmission.findFirst({
            where: and(
              eq(consentFormSubmission.id, parsed.data.submissionId),
              eq(
                consentFormSubmission.organizationId,
                parsed.data.organizationId
              )
            ),
          }),
        { db }
      );
      if (!submission) {
        return err(
          new FeatureError(ErrorCodes.NOT_FOUND, 'Consent form not found')
        );
      }
      return buildDownload(db, submission);
    },
    {
      properties: { submissionId: input.submissionId },
      internalErrorsOnly: true,
    }
  );

export type GetConsentPdfDownloadResult = Awaited<
  ReturnType<typeof getConsentPdfDownloadForPatient>
>;
