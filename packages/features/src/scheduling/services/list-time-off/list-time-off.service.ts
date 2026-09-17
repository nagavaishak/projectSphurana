import {
  type TimeOff,
  timeOff,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, gte, isNotNull, isNull, lte, or } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListTimeOffInput,
  listTimeOffSchema,
} from './list-time-off.schema.js';

const listTimeOffImpl = async (
  db: DbConnection,
  input: ListTimeOffInput
): Promise<Result<TimeOff[]>> => {
  const parsed = listTimeOffSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, practitionerId, locationId, from, to } = parsed.data;

  try {
    const practitionerFilter = practitionerId
      ? eq(timeOff.practitionerId, practitionerId)
      : undefined;

    // NULL `location_id` = every branch (plan §2.2). Keep those rows under a
    // branch filter — a practitioner's holiday is not branch-specific unless
    // someone said it was.
    const locationFilter = locationId
      ? or(isNull(timeOff.locationId), eq(timeOff.locationId, locationId))
      : undefined;

    const rows = await db
      .select()
      .from(timeOff)
      .where(
        and(
          eq(timeOff.organizationId, organizationId),
          practitionerFilter,
          locationFilter,
          or(
            // One-off overlapping window
            and(
              isNull(timeOff.rrule),
              lte(timeOff.startDate, to),
              gte(timeOff.endDate, from)
            ),
            // Recurring: starts before window ends and series not yet expired
            and(
              isNotNull(timeOff.rrule),
              lte(timeOff.startDate, to),
              or(
                isNull(timeOff.recurrenceEndDate),
                gte(timeOff.recurrenceEndDate, from)
              )
            )
          )
        )
      );

    rows.sort(
      (a: TimeOff, b: TimeOff) => a.startDate.getTime() - b.startDate.getTime()
    );

    return ok(rows);
  } catch (error) {
    logError('scheduling.listTimeOff', error, {
      feature: 'scheduling',
      extra: { organizationId, practitionerId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to list time off')
    );
  }
};

export const listTimeOff = (db: DbConnection, input: ListTimeOffInput) =>
  trackedResult(
    'scheduling.listTimeOff',
    () => withOrgScope((tx) => listTimeOffImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        practitionerId: input.practitionerId,
      },
    }
  );

export type ListTimeOffResult = Awaited<ReturnType<typeof listTimeOff>>;
