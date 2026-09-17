import { sequence } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
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
  type DeactivateSequenceInput,
  deactivateSequenceSchema,
} from './deactivate-sequence.schema.js';

const deactivateSequenceImpl = async (
  db: DbConnection,
  input: DeactivateSequenceInput
): Promise<Result<typeof result>> => {
  const parsed = deactivateSequenceSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const existing = await db.query.sequence.findFirst({
    where: (sequence, { eq, and, isNull }) =>
      and(
        eq(sequence.id, parsed.data.id),
        eq(sequence.organizationId, parsed.data.organizationId),
        isNull(sequence.deletedAt)
      ),
  });

  if (!existing) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        `Sequence with ID ${parsed.data.id} not found`,
        { id: parsed.data.id }
      )
    );
  }

  if (!existing.isActive) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        'Sequence is already inactive',
        { id: parsed.data.id }
      )
    );
  }

  const [result] = await db
    .update(sequence)
    .set({ isActive: false })
    .where(
      and(
        eq(sequence.id, parsed.data.id),
        eq(sequence.organizationId, parsed.data.organizationId),
        notDeleted(sequence)
      )
    )
    .returning();

  return ok(result);
};

export const deactivateSequence = (
  db: DbConnection,
  input: DeactivateSequenceInput
) =>
  trackedResult(
    'sequences.deactivateSequence',
    () => deactivateSequenceImpl(db, input),
    {
      properties: { sequenceId: input.id },
    }
  );

export type DeactivateSequenceResult = Awaited<
  ReturnType<typeof deactivateSequence>
>;
