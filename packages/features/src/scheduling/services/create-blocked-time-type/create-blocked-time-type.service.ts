import {
  type BlockedTimeType,
  blockedTimeType,
  isUniqueViolation,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type CreateBlockedTimeTypeInput,
  createBlockedTimeTypeSchema,
} from './create-blocked-time-type.schema.js';

const createBlockedTimeTypeImpl = async (
  db: DbConnection,
  input: CreateBlockedTimeTypeInput
): Promise<Result<BlockedTimeType>> => {
  const parsed = createBlockedTimeTypeSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    const [result] = await db
      .insert(blockedTimeType)
      .values(parsed.data)
      .returning();

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
    logError('scheduling.createBlockedTimeType', error, {
      feature: 'scheduling',
      extra: { organizationId: parsed.data.organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to create blocked time type'
      )
    );
  }
};

export const createBlockedTimeType = (
  db: DbConnection,
  input: CreateBlockedTimeTypeInput
) =>
  trackedResult(
    'scheduling.createBlockedTimeType',
    () => withOrgScope((tx) => createBlockedTimeTypeImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type CreateBlockedTimeTypeResult = Awaited<
  ReturnType<typeof createBlockedTimeType>
>;
