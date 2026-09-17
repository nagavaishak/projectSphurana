import {
  type TimeOff,
  timeOff,
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
  type UpdateTimeOffInput,
  updateTimeOffSchema,
} from './update-time-off.schema.js';

const updateTimeOffImpl = async (
  db: DbConnection,
  input: UpdateTimeOffInput
): Promise<Result<TimeOff>> => {
  const parsed = updateTimeOffSchema.safeParse(input);
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
      .update(timeOff)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(eq(timeOff.id, id), eq(timeOff.organizationId, organizationId))
      )
      .returning();

    if (!result) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Time off not found'));
    }

    return ok(result);
  } catch (error) {
    logError('scheduling.updateTimeOff', error, {
      feature: 'scheduling',
      extra: { id, organizationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to update time off')
    );
  }
};

export const updateTimeOff = (db: DbConnection, input: UpdateTimeOffInput) =>
  trackedResult(
    'scheduling.updateTimeOff',
    () => withOrgScope((tx) => updateTimeOffImpl(tx, input), { db }),
    {
      properties: { id: input.id, organizationId: input.organizationId },
    }
  );

export type UpdateTimeOffResult = Awaited<ReturnType<typeof updateTimeOff>>;
