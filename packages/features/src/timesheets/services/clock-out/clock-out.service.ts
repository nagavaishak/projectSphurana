import {
  type TimeEntry,
  timeEntry,
  timeEntryBreak,
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
import { resolveAutomationFlags } from '../derive-auto-clock/index.js';
import { deriveAutomatedBreaks } from '../derive-automated-breaks/index.js';
import { createRunAutoClockDeps } from '../run-auto-clock/index.js';
import { type ClockOutInput, clockOutSchema } from './clock-out.schema.js';

/** Allowed clock-skew for a manual clock-out time past "now" (5 minutes). */
const MANUAL_FUTURE_SKEW_MS = 5 * 60 * 1000;

/**
 * Clock a practitioner out — closes the entry (status → `completed`), ends any
 * break still in progress at the clock-out instant, and (when the
 * practitioner's `automatedBreaks` flag resolves on — practitioner_wage_config
 * → org_defaults → false, contract §1.5) inserts `source='auto'` break rows
 * derived from unpaid `blocked_time` occurrences within the entry window. This
 * is the same derivation the auto-clock path applies on clock-out.
 */
const clockOutImpl = async (
  db: DbConnection,
  input: ClockOutInput
): Promise<Result<TimeEntry>> => {
  const parsed = clockOutSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, timeEntryId, at, requestingUserId, canManageOthers } =
    parsed.data;

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

    // Ownership check: a caller may only clock out their own linked
    // practitioner's entry unless they are an admin/owner (canManageOthers).
    // System callers omit requestingUserId and bypass this.
    if (requestingUserId && !canManageOthers) {
      const entryPractitioner = await db.query.practitioner.findFirst({
        where: (t, { and: andOp, eq: eqOp }) =>
          andOp(
            eqOp(t.id, entry.practitionerId),
            eqOp(t.organizationId, organizationId)
          ),
        columns: { userId: true },
      });
      if (entryPractitioner?.userId !== requestingUserId) {
        return err(
          new FeatureError(
            ErrorCodes.FORBIDDEN,
            'You can only clock yourself out'
          )
        );
      }
    }
    if (entry.clockOut) {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'Time entry is already clocked out'
        )
      );
    }

    const clockOutAt = at ?? new Date();
    // Reject clock-out times more than a small skew past now so a manual edit
    // cannot record time that hasn't happened yet (mirrors the lower bound
    // against clock-in below).
    if (clockOutAt.getTime() > Date.now() + MANUAL_FUTURE_SKEW_MS) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'Clock-out time cannot be in the future'
        )
      );
    }
    if (clockOutAt.getTime() <= entry.clockIn.getTime()) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'Clock-out time must be after clock-in time'
        )
      );
    }

    // End any break still in progress at the clock-out instant
    await db
      .update(timeEntryBreak)
      .set({ breakEnd: clockOutAt })
      .where(
        and(
          eq(timeEntryBreak.timeEntryId, timeEntryId),
          isNull(timeEntryBreak.breakEnd)
        )
      );

    const [updated] = await db
      .update(timeEntry)
      .set({ clockOut: clockOutAt, status: 'completed' })
      .where(eq(timeEntry.id, timeEntryId))
      .returning();

    // Automated breaks (contract §1.5): unpaid blocked-time occurrences within
    // the entry window become source='auto' break rows when the practitioner's
    // automatedBreaks flag resolves on. Deps close over the same tx, so the
    // reads stay inside this operation's scope.
    const deps = createRunAutoClockDeps(db);
    const [wageConfig, orgWageDefaults] = await Promise.all([
      deps.getWageAutomationConfig({
        organizationId,
        practitionerId: entry.practitionerId,
      }),
      deps.getOrgWageDefaults({ organizationId }),
    ]);

    const flagsResult = resolveAutomationFlags({
      wageConfig,
      orgDefaults: orgWageDefaults,
    });
    if (flagsResult.success && flagsResult.data.automatedBreaks) {
      const occurrences = await deps.getUnpaidBlockedTimeOccurrences({
        organizationId,
        practitionerId: entry.practitionerId,
        from: entry.clockIn,
        to: clockOutAt,
      });
      const breaksResult = deriveAutomatedBreaks({
        clockIn: entry.clockIn,
        clockOut: clockOutAt,
        occurrences,
      });
      if (breaksResult.success && breaksResult.data.length > 0) {
        await db.insert(timeEntryBreak).values(
          breaksResult.data.map((b) => ({
            timeEntryId,
            breakStart: b.breakStart,
            breakEnd: b.breakEnd,
            source: 'auto' as const,
          }))
        );
      }
    }

    return ok(updated);
  } catch (error) {
    logError('timesheets.clockOut', error, {
      feature: 'timesheets',
      extra: { organizationId, timeEntryId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to clock out')
    );
  }
};

export const clockOut = (db: DbConnection, input: ClockOutInput) =>
  trackedResult(
    'timesheets.clockOut',
    () => withOrgScope((tx) => clockOutImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        timeEntryId: input.timeEntryId,
      },
    }
  );

export type ClockOutServiceResult = Awaited<ReturnType<typeof clockOut>>;
