import { lead, withSystemScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type StorageDeps,
  generatePresignedUploadUrl,
} from '../../../upload/index.js';
import {
  type PresignPatientDocumentInput,
  presignPatientDocumentSchema,
} from './presign-patient-document.schema.js';

export interface PresignedPatientDocumentUpload {
  /** Presigned PUT URL — upload the file bytes here directly. */
  url: string;
  /** S3 key under patient-documents/{orgId}/{leadId}/ — echo back on record. */
  key: string;
  expiresIn: number;
}

/**
 * Presign a single-PUT upload for a patient document (ENG-647 Phase 4).
 *
 * Thin, validated wrapper over the shared `generatePresignedUploadUrl`
 * plumbing with `purpose: 'patient-document'` — private org-assets bucket,
 * `patient-documents/{organizationId}/{leadId}/…` key. Exists as its own
 * service because the generic `upload/presigned-url` endpoint is
 * staff-guarded; the patient portal presigns through the patient-documents
 * controllers, which both delegate here with server-resolved ids.
 */
const presignPatientDocumentImpl = async (
  db: DbConnection,
  storage: StorageDeps,
  input: PresignPatientDocumentInput
): Promise<Result<PresignedPatientDocumentUpload>> => {
  const parsed = presignPatientDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, leadId, uploaderId, fileName, mimeType, sizeBytes } =
    parsed.data;

  // Verify the lead really is in this org BEFORE minting a URL.
  //
  // Only `createPatientDocument` checked this, so a staff user could presign
  // for any leadId string. The key is still rooted at their OWN org prefix,
  // so it was never a cross-org write — it littered orphan objects under a
  // path for a patient who does not exist there, and let the caller learn
  // nothing either way. Cheap to check here, and it keeps the two halves of
  // the upload honest about the same thing.
  const leadRow = await withSystemScope(
    (tx) =>
      tx.query.lead.findFirst({
        where: and(
          eq(lead.id, leadId),
          eq(lead.organizationId, organizationId)
        ),
      }),
    { db }
  );
  if (!leadRow) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Patient not found'));
  }

  const result = await generatePresignedUploadUrl(storage, {
    filename: fileName,
    contentType: mimeType,
    // Bind the signature to this exact size. The schema's 15MB max is checked
    // against a CLIENT-DECLARED number, so on its own it stops nothing: a
    // signed-in patient could declare 1KB and PUT an arbitrarily large object
    // into the private bucket. Signing content-length makes S3 enforce it.
    contentLength: sizeBytes,
    // `type` is a formality here: patient-document purpose validates against
    // its own content-type allowlist, not the image/video split.
    type: 'image',
    purpose: 'patient-document',
    userId: uploaderId,
    organizationId,
    leadId,
  });
  if (!result.success) {
    // trackedResult flattens errors to a plain shape — rewrap for Result<T>.
    return err(
      new FeatureError(
        result.error.code,
        result.error.message,
        result.error.details
      )
    );
  }

  return ok({
    url: result.data.url,
    key: result.data.key,
    expiresIn: result.data.expiresIn,
  });
};

export const presignPatientDocument = (
  db: DbConnection,
  storage: StorageDeps,
  input: PresignPatientDocumentInput
) =>
  trackedResult(
    'patientDocuments.presignPatientDocument',
    () => presignPatientDocumentImpl(db, storage, input),
    {
      properties: {
        organizationId: input.organizationId,
        leadId: input.leadId,
        mimeType: input.mimeType,
      },
    }
  );

export type PresignPatientDocumentResult = Awaited<
  ReturnType<typeof presignPatientDocument>
>;
