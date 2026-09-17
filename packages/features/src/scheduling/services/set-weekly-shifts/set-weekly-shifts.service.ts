import {
  type Shift,
  practitioner,
  shift,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, isNull } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type SetWeeklyShiftsInput,
  setWeeklyShiftsSchema,
} from './set-weekly-shifts.schema.js';

/**
 * Replace a practitioner's weekly pattern rows (contract §3.4). Date override
 * rows are untouched. Days omitted from the payload get no rows (= not
 * working that weekday).
 */
const setWeeklyShiftsImpl = async (
  db: DbConnection,
  input: SetWeeklyShiftsInput
): Promise<Result<Shift[]>> => {
  const parsed = setWeeklyShiftsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, practitionerId, locationId, days } = parsed.data;

  try {
    // The practitioner must belong to the caller's org. Without this check a
    // caller could write shift rows referencing another org's practitioner id
    // (the FK alone is org-agnostic), producing rows where
    // shift.organizationId !== practitioner.organizationId.
    const owned = await db.query.practitioner.findFirst({
      where: and(
        eq(practitioner.id, practitionerId),
        eq(practitioner.organizationId, organizationId)
      ),
      columns: { id: true },
    });
    if (!owned) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Practitioner not found')
      );
    }

    // Replace ALL weekly rows for this practitioner (date IS NULL).
    await db
      .delete(shift)
      .where(
        and(
          eq(shift.organizationId, organizationId),
          eq(shift.practitionerId, practitionerId),
          isNull(shift.date)
        )
      );

    const values = days.flatMap((day) =>
      day.intervals.map((interval) => ({
        organizationId,
        practitionerId,
        locationId: locationId ?? null,
        dayOfWeek: day.dayOfWeek,
        date: null,
        startMinutes: interval.startMinutes,
        endMinutes: interval.endMinutes,
        isOff: false,
      }))
    );

    if (values.length === 0) {
      return ok([]);
    }

    const created = await db.insert(shift).values(values).returning();

    return ok(created);
  } catch (error) {
    logError('scheduling.setWeeklyShifts', error, {
      feature: 'scheduling',
      extra: { organizationId, practitionerId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to set weekly shifts')
    );
  }
};

export const setWeeklyShifts = (
  db: DbConnection,
  input: SetWeeklyShiftsInput
) =>
  trackedResult(
    'scheduling.setWeeklyShifts',
    () => withOrgScope((tx) => setWeeklyShiftsImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        practitionerId: input.practitionerId,
      },
    }
  );

export type SetWeeklyShiftsResult = Awaited<ReturnType<typeof setWeeklyShifts>>;
