import { timeEntryBreak, withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import type { TimeEntryWithBreaks } from '../../models/index.js';
import {
  type StartBreakInput,
  startBreakSchema,
} from './start-break.schema.js';

/**
 * Start a break on an open time entry.
 * Fails with INVALID_STATE if the entry is clocked out, CONFLICT if a break
 * is already in progress.
 */
const startBreakImpl = async (
  db: DbConnection,
  input: StartBreakInput
): Promise<Result<TimeEntryWithBreaks>> => {
  const parsed = startBreakSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, timeEntryId, at, source } = parsed.data;

  try {
    const entry = await db.query.timeEntry.findFirst({
      where: (t, { and: andOp, eq: eqOp }) =>
        andOp(eqOp(t.id, timeEntryId), eqOp(t.organizationId, organizationId)),
      with: { breaks: true },
    });
    if (!entry) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Time entry not found')
      );
    }
    if (entry.clockOut) {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'Cannot start a break on a clocked-out entry'
        )
      );
    }

    const breaks = (entry as TimeEntryWithBreaks).breaks ?? [];
    if (breaks.some((b) => b.breakEnd === null)) {
      return err(
        new FeatureError(ErrorCodes.CONFLICT, 'A break is already in progress')
      );
    }

    const breakStart = at ?? new Date();
    if (breakStart.getTime() < entry.clockIn.getTime()) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'Break start must be after clock-in time'
        )
      );
    }

    const [created] = await db
      .insert(timeEntryBreak)
      .values({ timeEntryId, breakStart, source })
      .returning();

    return ok({ ...entry, breaks: [...breaks, created] });
  } catch (error) {
    logError('timesheets.startBreak', error, {
      feature: 'timesheets',
      extra: { organizationId, timeEntryId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to start break')
    );
  }
};

export const startBreak = (db: DbConnection, input: StartBreakInput) =>
  trackedResult(
    'timesheets.startBreak',
    () => withOrgScope((tx) => startBreakImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        timeEntryId: input.timeEntryId,
      },
    }
  );

export type StartBreakServiceResult = Awaited<ReturnType<typeof startBreak>>;
