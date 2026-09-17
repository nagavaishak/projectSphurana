import { type Shift, shift, withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, isNull, or } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import type { ResolvedShiftDay } from '../../models/scheduling.types.js';
import { resolveShiftDays } from '../../utils/resolve-shift-days.js';
import {
  type ListShiftsInput,
  listShiftsSchema,
} from './list-shifts.schema.js';

/**
 * Resolve shifts per practitioner per date within a window, overrides applied
 * (contract §3.4). Rows with a null locationId apply to all locations, so a
 * locationId filter keeps them.
 */
const listShiftsImpl = async (
  db: DbConnection,
  input: ListShiftsInput
): Promise<Result<ResolvedShiftDay[]>> => {
  const parsed = listShiftsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, from, to, locationId, practitionerId } = parsed.data;

  try {
    const rows: Shift[] = await db
      .select()
      .from(shift)
      .where(
        and(
          eq(shift.organizationId, organizationId),
          practitionerId ? eq(shift.practitionerId, practitionerId) : undefined,
          locationId
            ? or(isNull(shift.locationId), eq(shift.locationId, locationId))
            : undefined
        )
      );

    return ok(resolveShiftDays(rows, from, to));
  } catch (error) {
    logError('scheduling.listShifts', error, {
      feature: 'scheduling',
      extra: { organizationId, practitionerId, locationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to list shifts')
    );
  }
};

export const listShifts = (db: DbConnection, input: ListShiftsInput) =>
  trackedResult(
    'scheduling.listShifts',
    () => withOrgScope((tx) => listShiftsImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        practitionerId: input.practitionerId,
      },
    }
  );

export type ListShiftsResult = Awaited<ReturnType<typeof listShifts>>;
