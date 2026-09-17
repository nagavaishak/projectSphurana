import {
  type IntakeAnswer,
  formSubmission,
  withPublicOrgScope,
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
import { resolveIntakeToken } from '../../shared/resolve-intake-token.js';
import { validateIntakeAnswers } from '../../shared/validate-answers.js';
import {
  type SubmitIntakeFormInput,
  submitIntakeFormSchema,
} from './submit-intake-form.schema.js';

const submitIntakeFormImpl = async (
  db: DbConnection,
  input: SubmitIntakeFormInput
): Promise<Result<{ submissionId: string }>> => {
  const parsed = submitIntakeFormSchema.safeParse(input);
  if (!parsed.success) {
    return err(new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input'));
  }
  const resolved = await resolveIntakeToken(db, parsed.data);
  if (!resolved.success) return resolved;
  const { org, submission } = resolved.data;

  if (submission.status === 'completed') {
    // Idempotent-ish: a double submit (patient taps twice) is a conflict, not a
    // silent overwrite of a signed record.
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'This form has already been completed'
      )
    );
  }

  const answers = parsed.data.answers as Record<string, IntakeAnswer>;

  // Validate against the SNAPSHOT — the questions the patient was actually
  // shown. A required field left blank fails here, which is what stops a
  // required form being "completed" with holes.
  const errors = validateIntakeAnswers(submission.fieldsSnapshot, answers);
  if (errors.length > 0) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Please complete the required fields',
        {
          fields: errors,
        }
      )
    );
  }

  // Drop answers to questions the snapshot doesn't contain — a payload cannot
  // inject fields that were never asked.
  const known = new Set(submission.fieldsSnapshot.map((f) => f.id));
  const cleaned: Record<string, IntakeAnswer> = {};
  for (const [k, v] of Object.entries(answers)) {
    if (known.has(k)) cleaned[k] = v;
  }

  try {
    // Guard the UPDATE on status too, so two concurrent submits can't both win.
    const updated = await withPublicOrgScope(
      org.id,
      (tx) =>
        tx
          .update(formSubmission)
          .set({
            answers: cleaned,
            status: 'completed',
            completedAt: new Date(),
          })
          .where(
            and(
              eq(formSubmission.id, submission.id),
              eq(formSubmission.organizationId, org.id),
              eq(formSubmission.status, 'pending')
            )
          )
          .returning({ id: formSubmission.id }),
      { db }
    );
    if (updated.length === 0) {
      return err(
        new FeatureError(
          ErrorCodes.CONFLICT,
          'This form has already been completed'
        )
      );
    }
    return ok({ submissionId: submission.id });
  } catch (error) {
    logError('intakeForms.submitIntakeForm', error, {
      feature: 'intake-forms',
      extra: { submissionId: submission.id, organizationId: org.id },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to submit form')
    );
  }
};

export const submitIntakeForm = (
  db: DbConnection,
  input: SubmitIntakeFormInput
) =>
  trackedResult(
    'intakeForms.submitIntakeForm',
    () => submitIntakeFormImpl(db, input),
    {
      properties: { organizationSlug: input.organizationSlug },
    }
  );
export type SubmitIntakeFormResult = Awaited<
  ReturnType<typeof submitIntakeForm>
>;
