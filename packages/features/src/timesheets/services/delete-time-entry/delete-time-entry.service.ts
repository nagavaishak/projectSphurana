import { timeEntry, withOrgScope } from '@borradh-workspace/database';
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
  type DeleteTimeEntryInput,
  deleteTimeEntrySchema,
} from './delete-time-entry.schema.js';

/**
 * Delete a time entry (breaks cascade via FK).
 */
const deleteTimeEntryImpl = async (
  db: DbConnection,
  input: DeleteTimeEntryInput
): Promise<Result<{ success: true }>> => {
  const parsed = deleteTimeEntrySchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, timeEntryId } = parsed.data;

  try {
    const deleted = await db
      .delete(timeEntry)
      .where(
        and(
          eq(timeEntry.id, timeEntryId),
          eq(timeEntry.organizationId, organizationId)
        )
      )
      .returning();

    if (deleted.length === 0) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Time entry not found')
      );
    }

    return ok({ success: true });
  } catch (error) {
    logError('timesheets.deleteTimeEntry', error, {
      feature: 'timesheets',
      extra: { organizationId, timeEntryId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to delete time entry')
    );
  }
};

export const deleteTimeEntry = (
  db: DbConnection,
  input: DeleteTimeEntryInput
) =>
  trackedResult(
    'timesheets.deleteTimeEntry',
    () => withOrgScope((tx) => deleteTimeEntryImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        timeEntryId: input.timeEntryId,
      },
    }
  );

export type DeleteTimeEntryServiceResult = Awaited<
  ReturnType<typeof deleteTimeEntry>
>;
