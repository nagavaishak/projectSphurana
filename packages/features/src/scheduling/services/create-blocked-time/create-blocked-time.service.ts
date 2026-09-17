import {
  blockedTime,
  blockedTimePractitioner,
  blockedTimeType,
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
import type { BlockedTimeWithPractitioners } from '../../models/scheduling.types.js';
import {
  type CreateBlockedTimeInput,
  createBlockedTimeSchema,
} from './create-blocked-time.schema.js';

const createBlockedTimeImpl = async (
  db: DbConnection,
  input: CreateBlockedTimeInput
): Promise<Result<BlockedTimeWithPractitioners>> => {
  const parsed = createBlockedTimeSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { practitionerIds, paid, blockedTimeTypeId, ...values } = parsed.data;

  try {
    // Copy `paid` from the preset type at creation when not set explicitly.
    let resolvedPaid = paid ?? false;
    if (blockedTimeTypeId) {
      const [type] = await db
        .select()
        .from(blockedTimeType)
        .where(
          and(
            eq(blockedTimeType.id, blockedTimeTypeId),
            eq(blockedTimeType.organizationId, values.organizationId)
          )
        );
      if (!type) {
        return err(
          new FeatureError(ErrorCodes.NOT_FOUND, 'Blocked time type not found')
        );
      }
      resolvedPaid = paid ?? type.paid;
    }

    const [created] = await db
      .insert(blockedTime)
      .values({
        ...values,
        blockedTimeTypeId: blockedTimeTypeId ?? null,
        paid: resolvedPaid,
      })
      .returning();

    if (practitionerIds.length > 0) {
      await db.insert(blockedTimePractitioner).values(
        practitionerIds.map((practitionerId) => ({
          blockedTimeId: created.id,
          practitionerId,
        }))
      );
    }

    return ok({ ...created, practitionerIds });
  } catch (error) {
    logError('scheduling.createBlockedTime', error, {
      feature: 'scheduling',
      extra: { organizationId: values.organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to create blocked time'
      )
    );
  }
};

export const createBlockedTime = (
  db: DbConnection,
  input: CreateBlockedTimeInput
) =>
  trackedResult(
    'scheduling.createBlockedTime',
    () => withOrgScope((tx) => createBlockedTimeImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type CreateBlockedTimeResult = Awaited<
  ReturnType<typeof createBlockedTime>
>;
