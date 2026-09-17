import {
  type ConsentFormSubmission,
  consentFormSubmission,
  withOrgScope,
} from '@borradh-workspace/database';
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
  type ListConsentFormSubmissionsInput,
  listConsentFormSubmissionsSchema,
} from './list-consent-form-submissions.schema.js';

const listConsentFormSubmissionsImpl = async (
  db: DbConnection,
  input: ListConsentFormSubmissionsInput
): Promise<Result<{ items: ConsentFormSubmission[] }>> => {
  const parsed = listConsentFormSubmissionsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, appointmentId, leadId } = parsed.data;

  if (!appointmentId && !leadId) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Provide an appointmentId or a leadId to filter by'
      )
    );
  }

  try {
    const conditions: SQL[] = [
      eq(consentFormSubmission.organizationId, organizationId),
    ];
    if (appointmentId) {
      conditions.push(eq(consentFormSubmission.appointmentId, appointmentId));
    }
    if (leadId) {
      conditions.push(eq(consentFormSubmission.leadId, leadId));
    }

    const items = await db.query.consentFormSubmission.findMany({
      where: and(...conditions),
      orderBy: [desc(consentFormSubmission.createdAt)],
    });

    return ok({ items });
  } catch (error) {
    logError('consentForms.listConsentFormSubmissions', error, {
      feature: 'consent-forms',
      extra: { organizationId, appointmentId, leadId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to list consent form submissions'
      )
    );
  }
};

/** Staff-facing: submission status for an appointment or a lead. */
export const listConsentFormSubmissions = (
  db: DbConnection,
  input: ListConsentFormSubmissionsInput
) =>
  trackedResult(
    'consentForms.listConsentFormSubmissions',
    () =>
      withOrgScope((tx) => listConsentFormSubmissionsImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type ListConsentFormSubmissionsResult = Awaited<
  ReturnType<typeof listConsentFormSubmissions>
>;
