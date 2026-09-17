import { shift, withOrgScope } from '@borradh-workspace/database';
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
  type DeleteShiftOverrideInput,
  deleteShiftOverrideSchema,
} from './delete-shift-override.schema.js';

/**
 * Remove all override rows for (practitioner, date), reverting the day to
 * the weekly pattern (contract §3.4).
 */
const deleteShiftOverrideImpl = async (
  db: DbConnection,
  input: DeleteShiftOverrideInput
): Promise<Result<{ deleted: number }>> => {
  const parsed = deleteShiftOverrideSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, practitionerId, date } = parsed.data;

  try {
    const deleted = await db
      .delete(shift)
      .where(
        and(
          eq(shift.organizationId, organizationId),
          eq(shift.practitionerId, practitionerId),
          eq(shift.date, date)
        )
      )
      .returning({ id: shift.id });

    return ok({ deleted: deleted.length });
  } catch (error) {
    logError('scheduling.deleteShiftOverride', error, {
      feature: 'scheduling',
      extra: { organizationId, practitionerId, date },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to delete shift override'
      )
    );
  }
};

export const deleteShiftOverride = (
  db: DbConnection,
  input: DeleteShiftOverrideInput
) =>
  trackedResult(
    'scheduling.deleteShiftOverride',
    () => withOrgScope((tx) => deleteShiftOverrideImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        practitionerId: input.practitionerId,
        date: input.date,
      },
    }
  );

export type DeleteShiftOverrideResult = Awaited<
  ReturnType<typeof deleteShiftOverride>
>;
