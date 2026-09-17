import { timeOff, withOrgScope } from '@borradh-workspace/database';
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
  type DeleteTimeOffInput,
  deleteTimeOffSchema,
} from './delete-time-off.schema.js';

const deleteTimeOffImpl = async (
  db: DbConnection,
  input: DeleteTimeOffInput
): Promise<Result<{ id: string }>> => {
  const parsed = deleteTimeOffSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    const [result] = await db
      .delete(timeOff)
      .where(
        and(
          eq(timeOff.id, parsed.data.id),
          eq(timeOff.organizationId, parsed.data.organizationId)
        )
      )
      .returning({ id: timeOff.id });

    if (!result) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Time off not found'));
    }

    return ok(result);
  } catch (error) {
    logError('scheduling.deleteTimeOff', error, {
      feature: 'scheduling',
      extra: { id: parsed.data.id },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to delete time off')
    );
  }
};

export const deleteTimeOff = (db: DbConnection, input: DeleteTimeOffInput) =>
  trackedResult(
    'scheduling.deleteTimeOff',
    () => withOrgScope((tx) => deleteTimeOffImpl(tx, input), { db }),
    {
      properties: { id: input.id, organizationId: input.organizationId },
    }
  );

export type DeleteTimeOffResult = Awaited<ReturnType<typeof deleteTimeOff>>;
