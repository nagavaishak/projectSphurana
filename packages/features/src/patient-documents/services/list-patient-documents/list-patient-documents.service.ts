import {
  patientDocument,
  withOrgScope,
  withPatientScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, desc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type ListPatientDocumentsInput,
  listPatientDocumentsSchema,
} from './list-patient-documents.schema.js';

export interface PatientDocumentList {
  items: (typeof patientDocument.$inferSelect)[];
}

/**
 * Shared read — both variants filter by org + lead explicitly (correct even
 * with the RLS flag off) and exclude soft-deleted rows. Newest first.
 */
const listPatientDocumentsImpl = async (
  tx: DbConnection,
  input: ListPatientDocumentsInput
): Promise<Result<PatientDocumentList>> => {
  const items = await tx.query.patientDocument.findMany({
    where: and(
      eq(patientDocument.organizationId, input.organizationId),
      eq(patientDocument.leadId, input.leadId),
      notDeleted(patientDocument)
    ),
    orderBy: [desc(patientDocument.createdAt)],
  });

  return ok({ items });
};

/**
 * Portal variant (ENG-647 Phase 4): runs under `withPatientScope` on the
 * least-privilege `app_patient` pool, where the patient-self RLS policy makes
 * any other patient's rows invisible regardless of the WHERE clause.
 */
export const listPatientDocumentsForPatient = (
  db: DbConnection,
  input: ListPatientDocumentsInput
) =>
  trackedResult(
    'patientDocuments.listForPatient',
    async () => {
      const parsed = listPatientDocumentsSchema.safeParse(input);
      if (!parsed.success) {
        return err(
          new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
            issues: parsed.error.issues,
          })
        );
      }
      return withPatientScope(
        {
          leadId: parsed.data.leadId,
          organizationId: parsed.data.organizationId,
        },
        (tx) => listPatientDocumentsImpl(tx, parsed.data),
        { db }
      );
    },
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

/**
 * Staff variant: org-scoped read for the lead-profile documents tab.
 */
export const listPatientDocumentsForStaff = (
  db: DbConnection,
  input: ListPatientDocumentsInput
) =>
  trackedResult(
    'patientDocuments.listForStaff',
    async () => {
      const parsed = listPatientDocumentsSchema.safeParse(input);
      if (!parsed.success) {
        return err(
          new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
            issues: parsed.error.issues,
          })
        );
      }
      return withOrgScope((tx) => listPatientDocumentsImpl(tx, parsed.data), {
        db,
      });
    },
    {
      properties: {
        organizationId: input.organizationId,
        leadId: input.leadId,
      },
      internalErrorsOnly: true,
    }
  );

export type ListPatientDocumentsResult = Awaited<
  ReturnType<typeof listPatientDocumentsForStaff>
>;
