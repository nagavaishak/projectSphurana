import {
  consentFormSubmission,
  withPatientScope,
} from '@borradh-workspace/database';
import type { ConsentFormSubmissionStatus } from '@borradh-workspace/labels';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { type SQL, and, desc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  isPendingFormMoot,
  loadConsentAppointmentStates,
} from '../shared/index.js';
import {
  type ListPatientConsentFormsInput,
  listPatientConsentFormsSchema,
} from './list-patient-consent-forms.schema.js';

/** The trimmed list-row the portal sees — never the full submission. */
export interface PatientConsentFormListItem {
  id: string;
  appointmentId: string;
  status: ConsentFormSubmissionStatus;
  /** From the frozen snapshot — templates themselves are staff-only. */
  title: string;
  sentAt: Date | null;
  signedAt: Date | null;
}

const listPatientConsentFormsImpl = async (
  tx: DbConnection,
  input: ListPatientConsentFormsInput
): Promise<Result<{ items: PatientConsentFormListItem[] }>> => {
  const { leadId, organizationId, status } = input;

  try {
    // Explicit lead/org filters are defense-in-depth: with RLS on, the
    // patient_self policy already filters to the session's own rows.
    const conditions: SQL[] = [
      eq(consentFormSubmission.leadId, leadId),
      eq(consentFormSubmission.organizationId, organizationId),
    ];
    if (status) {
      conditions.push(eq(consentFormSubmission.status, status));
    }

    const rows = await tx.query.consentFormSubmission.findMany({
      where: and(...conditions),
      orderBy: [desc(consentFormSubmission.createdAt)],
    });

    // Drop forms whose appointment is no longer happening. A submission holds
    // no copy of the appointment's state, so a cancelled booking left its
    // pending forms sitting in the portal's "forms to complete" nudge for
    // ever — see `isPendingFormMoot` for why this is derived here rather than
    // stamped on the row at cancel time.
    const states = await loadConsentAppointmentStates(tx, {
      appointmentIds: [...new Set(rows.map((row) => row.appointmentId))],
      organizationId,
    });
    const live = rows.filter(
      (row) => !isPendingFormMoot(row.status, states.get(row.appointmentId))
    );

    return ok({
      items: live.map((row) => ({
        id: row.id,
        appointmentId: row.appointmentId,
        status: row.status,
        title: row.templateSnapshot.title,
        sentAt: row.sentAt,
        signedAt: row.signedAt,
      })),
    });
  } catch (error) {
    logError('consentForms.listPatientConsentForms', error, {
      feature: 'consent-forms',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to list your consent forms'
      )
    );
  }
};

/**
 * Patient-facing: the signed-in patient's own consent forms. Runs under
 * `withPatientScope` (app_patient pool + patient_self RLS policy).
 */
export const listPatientConsentForms = (
  db: DbConnection,
  input: ListPatientConsentFormsInput
) =>
  trackedResult(
    'consentForms.listPatientConsentForms',
    async () => {
      const parsed = listPatientConsentFormsSchema.safeParse(input);
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
        (tx) => listPatientConsentFormsImpl(tx, parsed.data),
        { db }
      );
    },
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type ListPatientConsentFormsResult = Awaited<
  ReturnType<typeof listPatientConsentForms>
>;
