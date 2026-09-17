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
  type ApproveTimeEntryInput,
  approveTimeEntrySchema,
} from './approve-time-entry.schema.js';

/**
 * Approve a completed time entry (manager action).
 * Idempotent for already-approved entries; open entries cannot be approved.
 */
const approveTimeEntryImpl = async (
  db: DbConnection,
  input: ApproveTimeEntryInput
): Promise<Result<TimeEntry>> => {
  const parsed = approveTimeEntrySchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, timeEntryId } = parsed.data;

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
      return ok(entry);
    }
    if (entry.status !== 'completed') {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'Only completed time entries can be approved'
        )
      );
    }

    const [updated] = await db
      .update(timeEntry)
      .set({ status: 'approved' })
      .where(eq(timeEntry.id, timeEntryId))
      .returning();

    return ok(updated);
  } catch (error) {
    logError('timesheets.approveTimeEntry', error, {
      feature: 'timesheets',
      extra: { organizationId, timeEntryId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to approve time entry'
      )
    );
  }
};

export const approveTimeEntry = (
  db: DbConnection,
  input: ApproveTimeEntryInput
) =>
  trackedResult(
    'timesheets.approveTimeEntry',
    () => withOrgScope((tx) => approveTimeEntryImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        timeEntryId: input.timeEntryId,
      },
    }
  );

export type ApproveTimeEntryServiceResult = Awaited<
  ReturnType<typeof approveTimeEntry>
>;
