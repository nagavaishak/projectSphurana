import {
  lead,
  patientDocument,
  withSystemScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import type {
  getMetadata as GetMetadataFn,
  getOrgAssetsBucket as GetOrgAssetsBucketFn,
  getS3Region as GetS3RegionFn,
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
import { PATIENT_DOCUMENT_CONTENT_TYPES } from '../../../upload/index.js';
import {
  type CreatePatientDocumentInput,
  createPatientDocumentSchema,
} from './create-patient-document.schema.js';

export interface CreatePatientDocumentStorageDeps {
  getOrgAssetsBucket: typeof GetOrgAssetsBucketFn;
  getS3Region: typeof GetS3RegionFn;
  getMetadata: typeof GetMetadataFn;
}

/**
 * Record a patient document row after the presigned PUT completed
 * (ENG-647 Phase 4).
 *
 * Runs under SYSTEM scope: the `app_patient` role is SELECT-only by design,
 * so every patient-initiated write goes through a system-scoped service with
 * ids the guard resolved server-side (never client-supplied org/lead ids on
 * the patient path). The staff path passes the route leadId — the lead/org
 * ownership check below is what stops a staff user recording a document
 * against another org's lead.
 */
const createPatientDocumentImpl = async (
  tx: DbConnection,
  storage: CreatePatientDocumentStorageDeps,
  input: CreatePatientDocumentInput
): Promise<Result<typeof patientDocument.$inferSelect>> => {
  const parsed = createPatientDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, leadId, key } = parsed.data;

  // The key must be one this org/patient's presign step produced — anything
  // else would let a client point a vault row at an arbitrary object.
  const expectedPrefix = `patient-documents/${organizationId}/${leadId}/`;
  if (!key.startsWith(expectedPrefix) || key.includes('..')) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Upload key does not belong to this patient'
      )
    );
  }

  // System scope bypasses RLS, so verify the lead really is in this org.
  const leadRow = await tx.query.lead.findFirst({
    where: and(eq(lead.id, leadId), eq(lead.organizationId, organizationId)),
  });
  if (!leadRow) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Patient not found'));
  }

  const bucket = storage.getOrgAssetsBucket();
  const region = storage.getS3Region();

  // Verify the object was actually uploaded, and trust S3's observed size/type
  // over the client's claim. Until now the row recorded whatever `fileName`,
  // `mimeType` and `sizeBytes` the client sent — so a row could point at a key
  // that was presigned but never PUT (phantom document), or carry a
  // `mimeType`/`sizeBytes` that don't match the bytes. HeadObject closes both:
  // no object ⇒ reject; and we persist the real content-type/size. (The upload
  // presign already signs content-type + content-length, so a mismatch here
  // means tampering or a broken upload — fail closed.)
  const metadata = await storage.getMetadata({ bucket, key });
  if (!metadata) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Upload not found — the file was not stored'
      )
    );
  }

  const observedType = metadata.contentType ?? parsed.data.mimeType;
  if (
    !(PATIENT_DOCUMENT_CONTENT_TYPES as readonly string[]).includes(
      observedType
    )
  ) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Uploaded file type is not allowed'
      )
    );
  }

  const blobUrl = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

  try {
    const [row] = await tx
      .insert(patientDocument)
      .values({
        organizationId,
        leadId,
        uploadedByType: parsed.data.uploadedByType,
        uploadedByUserId:
          parsed.data.uploadedByType === 'staff'
            ? (parsed.data.uploadedByUserId ?? null)
            : null,
        fileName: parsed.data.fileName,
        blobUrl,
        // Persist S3's observed values, not the client's claim.
        mimeType: observedType,
        sizeBytes: metadata.size ?? parsed.data.sizeBytes,
      })
      .returning();

    return ok(row);
  } catch (error) {
    logError('patientDocuments.createPatientDocument', error, {
      feature: 'patient-documents',
      extra: { organizationId, leadId, key },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to save document')
    );
  }
};

export const createPatientDocument = (
  db: DbConnection,
  storage: CreatePatientDocumentStorageDeps,
  input: CreatePatientDocumentInput
) =>
  trackedResult(
    'patientDocuments.createPatientDocument',
    () =>
      withSystemScope((tx) => createPatientDocumentImpl(tx, storage, input), {
        db,
      }),
    {
      properties: {
        organizationId: input.organizationId,
        leadId: input.leadId,
        uploadedByType: input.uploadedByType,
      },
    }
  );

export type CreatePatientDocumentResult = Awaited<
  ReturnType<typeof createPatientDocument>
>;
