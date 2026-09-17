import {
  type BlockedTimeType,
  blockedTimeType,
  isUniqueViolation,
  withOrgScope,
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
  type UpdateBlockedTimeTypeInput,
  updateBlockedTimeTypeSchema,
} from './update-blocked-time-type.schema.js';

const updateBlockedTimeTypeImpl = async (
  db: DbConnection,
  input: UpdateBlockedTimeTypeInput
): Promise<Result<BlockedTimeType>> => {
  const parsed = updateBlockedTimeTypeSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId, ...updates } = parsed.data;

  const patch = Object.fromEntries(
    Object.entries(updates).filter(([, v]) => v !== undefined)
  );

  try {
    const [result] = await db
      .update(blockedTimeType)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(blockedTimeType.id, id),
          eq(blockedTimeType.organizationId, organizationId)
        )
      )
      .returning();

    if (!result) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Blocked time type not found')
      );
    }

    return ok(result);
  } catch (error) {
    // drizzle wraps the postgres.js error — the constraint lives on the
    // `.cause` chain, not `error.message` (see isUniqueViolation).
    if (isUniqueViolation(error, 'blocked_time_type_org_name_unique')) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          'A blocked time type with this name already exists'
        )
      );
    }
    logError('scheduling.updateBlockedTimeType', error, {
      feature: 'scheduling',
      extra: { id, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to update blocked time type'
      )
    );
  }
};

export const updateBlockedTimeType = (
  db: DbConnection,
  input: UpdateBlockedTimeTypeInput
) =>
  trackedResult(
    'scheduling.updateBlockedTimeType',
    () => withOrgScope((tx) => updateBlockedTimeTypeImpl(tx, input), { db }),
    {
      properties: { id: input.id, organizationId: input.organizationId },
    }
  );

export type UpdateBlockedTimeTypeResult = Awaited<
  ReturnType<typeof updateBlockedTimeType>
>;
