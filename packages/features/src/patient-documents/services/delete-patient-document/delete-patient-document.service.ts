import { patientDocument, withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, isNull } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type DeletePatientDocumentInput,
  deletePatientDocumentSchema,
} from './delete-patient-document.schema.js';

/**
 * Soft-delete a patient document (ENG-647 Phase 4) — STAFF ONLY.
 *
 * Patients cannot delete vault entries in v1 (clinical files may be part of
 * the care record); the patient-side controller simply has no delete route.
 * Soft delete keeps the row (and blob) for retention — the S3 object is NOT
 * removed.
 */
const deletePatientDocumentImpl = async (
  tx: DbConnection,
  input: DeletePatientDocumentInput
): Promise<Result<{ id: string }>> => {
  try {
    const [row] = await tx
      .update(patientDocument)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(patientDocument.id, input.documentId),
          eq(patientDocument.organizationId, input.organizationId),
          eq(patientDocument.leadId, input.leadId),
          isNull(patientDocument.deletedAt)
        )
      )
      .returning({ id: patientDocument.id });

    if (!row) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Document not found'));
    }

    return ok({ id: row.id });
  } catch (error) {
    logError('patientDocuments.deletePatientDocument', error, {
      feature: 'patient-documents',
      extra: {
        organizationId: input.organizationId,
        documentId: input.documentId,
      },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to delete document')
    );
  }
};

export const deletePatientDocument = (
  db: DbConnection,
  input: DeletePatientDocumentInput
) =>
  trackedResult(
    'patientDocuments.deletePatientDocument',
    async () => {
      const parsed = deletePatientDocumentSchema.safeParse(input);
      if (!parsed.success) {
        return err(
          new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
            issues: parsed.error.issues,
          })
        );
      }
      return withOrgScope((tx) => deletePatientDocumentImpl(tx, parsed.data), {
        db,
      });
    },
    {
      properties: {
        organizationId: input.organizationId,
        documentId: input.documentId,
      },
    }
  );

export type DeletePatientDocumentResult = Awaited<
  ReturnType<typeof deletePatientDocument>
>;
