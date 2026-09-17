import { form, formSubmission } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
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
  generateIntakeToken,
  hashIntakeToken,
} from '../../shared/intake-token.js';
import {
  type IssueIntakeSubmissionInput,
  issueIntakeSubmissionSchema,
} from './issue-intake-submission.schema.js';

/**
 * Mint a pending submission for (form, lead, appointment) and return the RAW
 * token — the caller embeds it in the send link and drops it.
 *
 * The form's questions are SNAPSHOTTED onto the submission here, so the patient
 * answers (and the clinic later reads) the form exactly as it stood at send
 * time, even if the template is edited afterwards. That is what makes a signed
 * consent a stable record.
 *
 * `kind` and `patient_visibility` are denormalised from the template for the
 * same reason the schema denormalises them: RLS and the "what is outstanding"
 * reads must decide what they may show without a join.
 */
const issueIntakeSubmissionImpl = async (
  db: DbConnection,
  input: IssueIntakeSubmissionInput
): Promise<Result<{ submissionId: string; token: string }>> => {
  const parsed = issueIntakeSubmissionSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { organizationId, intakeFormId, leadId, appointmentId } = parsed.data;

  const template = await db.query.form.findFirst({
    where: and(
      eq(form.id, intakeFormId),
      eq(form.organizationId, organizationId),
      eq(form.kind, 'intake'),
      notDeleted(form)
    ),
  });
  if (!template)
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Form not found'));

  const token = generateIntakeToken();
  try {
    const [row] = await db
      .insert(formSubmission)
      .values({
        organizationId,
        formId: intakeFormId,
        kind: 'intake',
        patientVisibility: template.patientVisibility,
        leadId,
        appointmentId,
        status: 'pending',
        tokenHash: hashIntakeToken(token),
        fieldsSnapshot: template.fields,
        answers: {},
        sentAt: new Date(),
      })
      .returning({ id: formSubmission.id });
    return ok({ submissionId: row.id, token });
  } catch (error) {
    logError('intakeForms.issueIntakeSubmission', error, {
      feature: 'intake-forms',
      extra: { intakeFormId, leadId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to issue form')
    );
  }
};

export const issueIntakeSubmission = (
  db: DbConnection,
  input: IssueIntakeSubmissionInput
) =>
  trackedResult(
    'intakeForms.issueIntakeSubmission',
    () => issueIntakeSubmissionImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        intakeFormId: input.intakeFormId,
      },
    }
  );
export type IssueIntakeSubmissionResult = Awaited<
  ReturnType<typeof issueIntakeSubmission>
>;
