import {
  type TimeEntry,
  timeEntry,
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
  type UpdateTimeEntryInput,
  updateTimeEntrySchema,
} from './update-time-entry.schema.js';

/**
 * Manually edit a time entry's clock-in/clock-out.
 * Approved entries cannot be edited. Setting clockOut completes an open
 * entry; clearing it (null) re-opens a completed one.
 */
const updateTimeEntryImpl = async (
  db: DbConnection,
  input: UpdateTimeEntryInput
): Promise<Result<TimeEntry>> => {
  const parsed = updateTimeEntrySchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, timeEntryId, clockIn, clockOut } = parsed.data;

  try {
    const entry = await db.query.timeEntry.findFirst({
      where: (t, { and: andOp, eq: eqOp }) =>
        andOp(eqOp(t.id, timeEntryId), eqOp(t.organizationId, organizationId)),
    });
    if (!entry) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Time entry not found')
      );
    }
    if (entry.status === 'approved') {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'Approved time entries cannot be edited'
        )
      );
    }

    const nextClockIn = clockIn ?? entry.clockIn;
    const nextClockOut = clockOut === undefined ? entry.clockOut : clockOut;
    if (nextClockOut && nextClockOut.getTime() <= nextClockIn.getTime()) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'Clock-out time must be after clock-in time'
        )
      );
    }

    // Re-open guard: an entry with no clock-out is "open", and a practitioner
    // may only have one open entry at a time. Before clearing clockOut (and
    // flipping status back to 'open'), make sure no other open entry exists for
    // this practitioner — otherwise a manual edit could create a second open
    // entry and wedge the clock-in/auto-clock flows. Complements the partial
    // unique index the orchestrator adds at the DB level.
    if (!nextClockOut) {
      const otherOpen = await db.query.timeEntry.findFirst({
        where: (t, { and: andOp, eq: eqOp, isNull, ne }) =>
          andOp(
            eqOp(t.organizationId, organizationId),
            eqOp(t.practitionerId, entry.practitionerId),
            isNull(t.clockOut),
            ne(t.id, timeEntryId)
          ),
        columns: { id: true },
      });
      if (otherOpen) {
        return err(
          new FeatureError(
            ErrorCodes.CONFLICT,
            'This practitioner already has an open time entry'
          )
        );
      }
    }

    const [updated] = await db
      .update(timeEntry)
      .set({
        clockIn: nextClockIn,
        clockOut: nextClockOut,
        status: nextClockOut ? 'completed' : 'open',
      })
      .where(eq(timeEntry.id, timeEntryId))
      .returning();

    return ok(updated);
  } catch (error) {
    logError('timesheets.updateTimeEntry', error, {
      feature: 'timesheets',
      extra: { organizationId, timeEntryId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to update time entry')
    );
  }
};

export const updateTimeEntry = (
  db: DbConnection,
  input: UpdateTimeEntryInput
) =>
  trackedResult(
    'timesheets.updateTimeEntry',
    () => withOrgScope((tx) => updateTimeEntryImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        timeEntryId: input.timeEntryId,
      },
    }
  );

export type UpdateTimeEntryServiceResult = Awaited<
  ReturnType<typeof updateTimeEntry>
>;
