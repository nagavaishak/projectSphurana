import {
  type TimeOff,
  timeOff,
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
  type CreateTimeOffInput,
  createTimeOffSchema,
} from './create-time-off.schema.js';

const createTimeOffImpl = async (
  db: DbConnection,
  input: CreateTimeOffInput
): Promise<Result<TimeOff>> => {
  const parsed = createTimeOffSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    const [result] = await db.insert(timeOff).values(parsed.data).returning();

    return ok(result);
  } catch (error) {
    logError('scheduling.createTimeOff', error, {
      feature: 'scheduling',
      extra: {
        organizationId: parsed.data.organizationId,
        practitionerId: parsed.data.practitionerId,
      },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to create time off')
    );
  }
};

export const createTimeOff = (db: DbConnection, input: CreateTimeOffInput) =>
  trackedResult(
    'scheduling.createTimeOff',
    () => withOrgScope((tx) => createTimeOffImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        practitionerId: input.practitionerId,
      },
    }
  );

export type CreateTimeOffResult = Awaited<ReturnType<typeof createTimeOff>>;
