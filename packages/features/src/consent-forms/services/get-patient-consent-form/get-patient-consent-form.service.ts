import {
  type ConsentFormSubmission,
  consentFormSubmission,
  withPatientScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
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
  isPendingFormMoot,
  loadConsentAppointmentState,
} from '../shared/index.js';
import {
  type GetPatientConsentFormInput,
  getPatientConsentFormSchema,
} from './get-patient-consent-form.schema.js';

const getPatientConsentFormImpl = async (
  tx: DbConnection,
  input: GetPatientConsentFormInput
): Promise<Result<ConsentFormSubmission>> => {
  const { leadId, organizationId, submissionId } = input;

  try {
    // Explicit lead/org filters are defense-in-depth: with RLS on, the
    // patient_self policy filters any row that is not the patient's own —
    // a filtered row is a NOT_FOUND, never someone else's record.
    const row = await tx.query.consentFormSubmission.findFirst({
      where: and(
        eq(consentFormSubmission.id, submissionId),
        eq(consentFormSubmission.leadId, leadId),
        eq(consentFormSubmission.organizationId, organizationId)
      ),
    });

    if (!row) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Consent form not found')
      );
    }

    // A pending form for an appointment that is no longer happening is not
    // signable, so it is not reachable either — an emailed link or a stale tab
    // must not still open the sign screen. NOT_FOUND, not a special shape: the
    // portal already renders that as "this form may have been removed".
    // A COMPLETED form stays reachable whatever happened to the appointment.
    const appointmentState = await loadConsentAppointmentState(tx, {
      appointmentId: row.appointmentId,
      organizationId,
    });
    if (isPendingFormMoot(row.status, appointmentState)) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Consent form not found')
      );
    }

    return ok(row);
  } catch (error) {
    logError('consentForms.getPatientConsentForm', error, {
      feature: 'consent-forms',
      extra: { submissionId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to load the consent form'
      )
    );
  }
};

/**
 * Patient-facing: one submission in full (frozen snapshot + the patient's
 * answers) for rendering the sign screen. Runs under `withPatientScope`.
 */
export const getPatientConsentForm = (
  db: DbConnection,
  input: GetPatientConsentFormInput
) =>
  trackedResult(
    'consentForms.getPatientConsentForm',
    async () => {
      const parsed = getPatientConsentFormSchema.safeParse(input);
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
        (tx) => getPatientConsentFormImpl(tx, parsed.data),
        { db }
      );
    },
    {
      properties: {
        submissionId: input.submissionId,
        organizationId: input.organizationId,
      },
      internalErrorsOnly: true,
    }
  );

export type GetPatientConsentFormResult = Awaited<
  ReturnType<typeof getPatientConsentForm>
>;
