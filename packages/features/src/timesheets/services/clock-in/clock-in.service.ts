import {
  type TimeEntry,
  timeEntry,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { type ClockInInput, clockInSchema } from './clock-in.schema.js';

/**
 * Clock a practitioner in — creates an `open` time entry.
 * Fails with CONFLICT if the practitioner already has an open entry.
 */
const clockInImpl = async (
  db: DbConnection,
  input: ClockInInput
): Promise<Result<TimeEntry>> => {
  const parsed = clockInSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    practitionerId,
    at,
    source,
    requestingUserId,
    canManageOthers,
  } = parsed.data;

  try {
    const existingPractitioner = await db.query.practitioner.findFirst({
      where: (t, { and, eq }) =>
        and(
          eq(t.id, practitionerId),
          eq(t.organizationId, organizationId),
          notDeleted(t)
        ),
    });
    if (!existingPractitioner) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Practitioner not found')
      );
    }

    // Ownership check: a caller may only clock in their own linked practitioner
    // unless they are an admin/owner (canManageOthers). System callers omit
    // requestingUserId and bypass this. Distinct from NOT_FOUND above so the
    // practitioner's existence isn't leaked as a different status.
    if (
      requestingUserId &&
      !canManageOthers &&
      existingPractitioner.userId !== requestingUserId
    ) {
      return err(
        new FeatureError(ErrorCodes.FORBIDDEN, 'You can only clock yourself in')
      );
    }

    const openEntry = await db.query.timeEntry.findFirst({
      where: (t, { and, eq, isNull }) =>
        and(
          eq(t.organizationId, organizationId),
          eq(t.practitionerId, practitionerId),
          isNull(t.clockOut)
        ),
    });
    if (openEntry) {
      return err(
        new FeatureError(
          ErrorCodes.CONFLICT,
          'Practitioner is already clocked in'
        )
      );
    }

    const [created] = await db
      .insert(timeEntry)
      .values({
        organizationId,
        practitionerId,
        clockIn: at ?? new Date(),
        source,
        status: 'open',
      })
      .returning();

    return ok(created);
  } catch (error) {
    logError('timesheets.clockIn', error, {
      feature: 'timesheets',
      extra: { organizationId, practitionerId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to clock in')
    );
  }
};

export const clockIn = (db: DbConnection, input: ClockInInput) =>
  trackedResult(
    'timesheets.clockIn',
    () => withOrgScope((tx) => clockInImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        practitionerId: input.practitionerId,
      },
    }
  );

export type ClockInServiceResult = Awaited<ReturnType<typeof clockIn>>;
