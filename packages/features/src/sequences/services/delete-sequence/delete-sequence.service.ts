import { sequence } from '@borradh-workspace/database';
import {
  isFeatureOn,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  logAuditEvent,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type DeleteSequenceInput,
  deleteSequenceSchema,
} from './delete-sequence.schema.js';

const deleteSequenceImpl = async (
  db: DbConnection,
  input: DeleteSequenceInput
): Promise<Result<{ success: true }>> => {
  const parsed = deleteSequenceSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId, actorId } = parsed.data;

  // Check if sequence exists and belongs to the organization
  const existingSequence = await db.query.sequence.findFirst({
    where: (seq, { eq: eqOp, and: andOp, isNull }) =>
      andOp(
        eqOp(seq.id, id),
        eqOp(seq.organizationId, organizationId),
        isNull(seq.deletedAt)
      ),
  });

  if (!existingSequence) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        `Sequence with ID ${id} not found`,
        { id }
      )
    );
  }

  try {
    if (!(await isFeatureOn('killswitch-soft-deletes'))) {
      await db
        .delete(sequence)
        .where(
          and(eq(sequence.id, id), eq(sequence.organizationId, organizationId))
        );
      return ok({ success: true });
    }

    await db
      .update(sequence)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(sequence.id, id),
          eq(sequence.organizationId, organizationId),
          notDeleted(sequence)
        )
      );

    logAuditEvent(db, {
      action: 'delete',
      entityType: 'sequence',
      entityId: id,
      actorType: 'user',
      actorId: actorId ?? null,
      organizationId,
    }).catch((error) => {
      logError('sequences.deleteSequence.auditLog', error, {
        feature: 'sequences',
        extra: { sequenceId: id, organizationId },
      });
    });

    return ok({ success: true });
  } catch (error) {
    logError('sequences.deleteSequence', error, {
      feature: 'sequences',
      extra: { sequenceId: id, organizationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to delete sequence')
    );
  }
};

export const deleteSequence = (db: DbConnection, input: DeleteSequenceInput) =>
  trackedResult(
    'sequences.deleteSequence',
    () => deleteSequenceImpl(db, input),
    {
      properties: { sequenceId: input.id },
    }
  );

export type DeleteSequenceResult = Awaited<ReturnType<typeof deleteSequence>>;
