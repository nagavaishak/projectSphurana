import { form } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { resolveIntakeToken } from '../../shared/resolve-intake-token.js';
import { toIntakeAnswers } from '../../shared/wire-shape.js';
import {
  type GetIntakeSubmissionInput,
  type PublicIntakeView,
  getIntakeSubmissionSchema,
} from './get-intake-submission.schema.js';

const getIntakeSubmissionImpl = async (
  db: DbConnection,
  input: GetIntakeSubmissionInput
): Promise<Result<PublicIntakeView>> => {
  const parsed = getIntakeSubmissionSchema.safeParse(input);
  if (!parsed.success) {
    return err(new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input'));
  }
  const resolved = await resolveIntakeToken(db, parsed.data);
  if (!resolved.success) return resolved;
  const { org, submission } = resolved.data;

  // Name/description come from the live form (cosmetic); the QUESTIONS come from
  // the submission snapshot (legal record). If the form was hard-deleted, the
  // snapshot still lets the patient complete what they were sent.
  const template = await db.query.form.findFirst({
    where: eq(form.id, submission.formId),
  });

  return ok({
    submissionId: submission.id,
    formName: template?.name ?? 'Intake form',
    formDescription: template?.description ?? null,
    fields: submission.fieldsSnapshot,
    status: submission.status,
    answers: toIntakeAnswers(submission.answers),
    organization: { name: org.name, slug: org.slug, logo: org.logo ?? null },
  });
};

export const getIntakeSubmission = (
  db: DbConnection,
  input: GetIntakeSubmissionInput
) =>
  trackedResult(
    'intakeForms.getIntakeSubmission',
    () => getIntakeSubmissionImpl(db, input),
    {
      properties: { organizationSlug: input.organizationSlug },
      internalErrorsOnly: true,
    }
  );
export type GetIntakeSubmissionResult = Awaited<
  ReturnType<typeof getIntakeSubmission>
>;
