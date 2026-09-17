import {
  type Shift,
  practitioner,
  shift,
  withOrgScope,
} from '@borradh-workspace/database';
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
  type SetShiftOverrideInput,
  setShiftOverrideSchema,
} from './set-shift-override.schema.js';

/**
 * Replace a practitioner's override rows for one date (contract §3.4).
 * `isOff=true` writes a single "no shift this day" row with null minutes.
 */
const setShiftOverrideImpl = async (
  db: DbConnection,
  input: SetShiftOverrideInput
): Promise<Result<Shift[]>> => {
  const parsed = setShiftOverrideSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, practitionerId, date, locationId, isOff, intervals } =
    parsed.data;

  try {
    // The practitioner must belong to the caller's org — otherwise a caller
    // could write override rows against another org's practitioner id.
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

    await db
      .delete(shift)
      .where(
        and(
          eq(shift.organizationId, organizationId),
          eq(shift.practitionerId, practitionerId),
          eq(shift.date, date)
        )
      );

    const values = isOff
      ? [
          {
            organizationId,
            practitionerId,
            locationId: locationId ?? null,
            dayOfWeek: null,
            date,
            startMinutes: null,
            endMinutes: null,
            isOff: true,
          },
        ]
      : intervals.map((interval) => ({
          organizationId,
          practitionerId,
          locationId: locationId ?? null,
          dayOfWeek: null,
          date,
          startMinutes: interval.startMinutes,
          endMinutes: interval.endMinutes,
          isOff: false,
        }));

    const created = await db.insert(shift).values(values).returning();

    return ok(created);
  } catch (error) {
    logError('scheduling.setShiftOverride', error, {
      feature: 'scheduling',
      extra: { organizationId, practitionerId, date },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to set shift override'
      )
    );
  }
};

export const setShiftOverride = (
  db: DbConnection,
  input: SetShiftOverrideInput
) =>
  trackedResult(
    'scheduling.setShiftOverride',
    () => withOrgScope((tx) => setShiftOverrideImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        practitionerId: input.practitionerId,
        date: input.date,
      },
    }
  );

export type SetShiftOverrideResult = Awaited<
  ReturnType<typeof setShiftOverride>
>;
