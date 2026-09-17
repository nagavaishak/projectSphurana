import { blockedTimeType, withOrgScope } from '@borradh-workspace/database';
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
  type DeleteBlockedTimeTypeInput,
  deleteBlockedTimeTypeSchema,
} from './delete-blocked-time-type.schema.js';

const deleteBlockedTimeTypeImpl = async (
  db: DbConnection,
  input: DeleteBlockedTimeTypeInput
): Promise<Result<{ id: string }>> => {
  const parsed = deleteBlockedTimeTypeSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    const [result] = await db
      .delete(blockedTimeType)
      .where(
        and(
          eq(blockedTimeType.id, parsed.data.id),
          eq(blockedTimeType.organizationId, parsed.data.organizationId)
        )
      )
      .returning({ id: blockedTimeType.id });

    if (!result) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Blocked time type not found')
      );
    }

    return ok(result);
  } catch (error) {
    logError('scheduling.deleteBlockedTimeType', error, {
      feature: 'scheduling',
      extra: { id: parsed.data.id },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to delete blocked time type'
      )
    );
  }
};

export const deleteBlockedTimeType = (
  db: DbConnection,
  input: DeleteBlockedTimeTypeInput
) =>
  trackedResult(
    'scheduling.deleteBlockedTimeType',
    () => withOrgScope((tx) => deleteBlockedTimeTypeImpl(tx, input), { db }),
    {
      properties: { id: input.id, organizationId: input.organizationId },
    }
  );

export type DeleteBlockedTimeTypeResult = Awaited<
  ReturnType<typeof deleteBlockedTimeType>
>;
