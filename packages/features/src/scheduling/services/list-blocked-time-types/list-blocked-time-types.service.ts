import {
  type BlockedTimeType,
  blockedTimeType,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListBlockedTimeTypesInput,
  listBlockedTimeTypesSchema,
} from './list-blocked-time-types.schema.js';

const listBlockedTimeTypesImpl = async (
  db: DbConnection,
  input: ListBlockedTimeTypesInput
): Promise<Result<BlockedTimeType[]>> => {
  const parsed = listBlockedTimeTypesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    const rows = await db
      .select()
      .from(blockedTimeType)
      .where(eq(blockedTimeType.organizationId, parsed.data.organizationId));

    rows.sort((a, b) => a.name.localeCompare(b.name));

    return ok(rows);
  } catch (error) {
    logError('scheduling.listBlockedTimeTypes', error, {
      feature: 'scheduling',
      extra: { organizationId: parsed.data.organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to list blocked time types'
      )
    );
  }
};

export const listBlockedTimeTypes = (
  db: DbConnection,
  input: ListBlockedTimeTypesInput
) =>
  trackedResult(
    'scheduling.listBlockedTimeTypes',
    () => withOrgScope((tx) => listBlockedTimeTypesImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type ListBlockedTimeTypesResult = Awaited<
  ReturnType<typeof listBlockedTimeTypes>
>;
