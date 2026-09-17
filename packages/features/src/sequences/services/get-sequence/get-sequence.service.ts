import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type GetSequenceInput,
  getSequenceSchema,
} from './get-sequence.schema.js';

const getSequenceImpl = async (
  db: DbConnection,
  input: GetSequenceInput
): Promise<Result<typeof result>> => {
  const parsed = getSequenceSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const result = await db.query.sequence.findFirst({
    where: (sequence, { eq, and, isNull }) =>
      and(
        eq(sequence.id, parsed.data.id),
        eq(sequence.organizationId, parsed.data.organizationId),
        isNull(sequence.deletedAt)
      ),
  });

  if (!result) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        `Sequence with ID ${parsed.data.id} not found`,
        { id: parsed.data.id }
      )
    );
  }

  return ok(result);
};

export const getSequence = (db: DbConnection, input: GetSequenceInput) =>
  trackedResult('sequences.getSequence', () => getSequenceImpl(db, input), {
    properties: { sequenceId: input.id },
    internalErrorsOnly: true,
  });

export type GetSequenceResult = Awaited<ReturnType<typeof getSequence>>;
