import { calendarAccount, withOrgScope } from '@borradh-workspace/database';
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
  type UpdateCalendarSelectionInput,
  updateCalendarSelectionSchema,
} from './update-calendar-selection.schema.js';

const updateCalendarSelectionImpl = async (
  db: DbConnection,
  input: UpdateCalendarSelectionInput
): Promise<Result<{ id: string; calendarId: string }>> => {
  const parsed = updateCalendarSelectionSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, accountId, calendarId } = parsed.data;

  try {
    // Verify the account exists and belongs to the org
    const account = await db.query.calendarAccount.findFirst({
      where: and(
        eq(calendarAccount.id, accountId),
        eq(calendarAccount.organizationId, organizationId)
      ),
      columns: { id: true },
    });

    if (!account) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Calendar account not found')
      );
    }

    // Update the selected calendar
    const [updated] = await db
      .update(calendarAccount)
      .set({ calendarId })
      .where(
        and(
          eq(calendarAccount.id, accountId),
          eq(calendarAccount.organizationId, organizationId)
        )
      )
      .returning({
        id: calendarAccount.id,
        calendarId: calendarAccount.calendarId,
      });

    if (!updated) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Calendar account not found')
      );
    }

    return ok(updated);
  } catch (error) {
    logError('integrations.updateCalendarSelection', error, {
      feature: 'integrations',
      extra: { organizationId, accountId, calendarId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to update calendar selection'
      )
    );
  }
};

export const updateCalendarSelection = (
  db: DbConnection,
  input: UpdateCalendarSelectionInput
) =>
  trackedResult(
    'integrations.updateCalendarSelection',
    () => withOrgScope((tx) => updateCalendarSelectionImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        accountId: input.accountId,
      },
    }
  );

export type UpdateCalendarSelectionResult = Awaited<
  ReturnType<typeof updateCalendarSelection>
>;
