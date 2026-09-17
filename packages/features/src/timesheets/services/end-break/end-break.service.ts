import { timeEntryBreak, withOrgScope } from '@borradh-workspace/database';
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
import type { TimeEntryWithBreaks } from '../../models/index.js';
import { type EndBreakInput, endBreakSchema } from './end-break.schema.js';

/**
 * End the break currently in progress on a time entry.
 */
const endBreakImpl = async (
  db: DbConnection,
  input: EndBreakInput
): Promise<Result<TimeEntryWithBreaks>> => {
  const parsed = endBreakSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, timeEntryId, at } = parsed.data;

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

    const breaks = (entry as TimeEntryWithBreaks).breaks ?? [];
    const openBreak = breaks.find((b) => b.breakEnd === null);
    if (!openBreak) {
      return err(
        new FeatureError(ErrorCodes.INVALID_STATE, 'No break in progress')
      );
    }

    const breakEnd = at ?? new Date();
    if (breakEnd.getTime() <= openBreak.breakStart.getTime()) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'Break end must be after break start'
        )
      );
    }

    const [updated] = await db
      .update(timeEntryBreak)
      .set({ breakEnd })
      .where(eq(timeEntryBreak.id, openBreak.id))
      .returning();

    return ok({
      ...entry,
      breaks: breaks.map((b) => (b.id === openBreak.id ? updated : b)),
    });
  } catch (error) {
    logError('timesheets.endBreak', error, {
      feature: 'timesheets',
      extra: { organizationId, timeEntryId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to end break')
    );
  }
};

export const endBreak = (db: DbConnection, input: EndBreakInput) =>
  trackedResult(
    'timesheets.endBreak',
    () => withOrgScope((tx) => endBreakImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        timeEntryId: input.timeEntryId,
      },
    }
  );

export type EndBreakServiceResult = Awaited<ReturnType<typeof endBreak>>;
