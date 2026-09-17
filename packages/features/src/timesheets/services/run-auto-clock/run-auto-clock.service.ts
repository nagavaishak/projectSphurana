import {
  type TimeEntry,
  organization,
  practitionerWageConfig,
  timeEntry,
  timeEntryBreak,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { getOrgDefaults } from '../../../org-defaults/index.js';
import { listBlockedTime, listShifts } from '../../../scheduling/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
  zonedWallTimeToUtc,
} from '../../../shared/index.js';
import type {
  ContractBlockedTimeOccurrence,
  ContractOrgWageDefaults,
  ContractShiftWindow,
  ContractWageAutomationConfig,
} from '../../models/index.js';
import {
  deriveAutoClock,
  resolveAutomationFlags,
} from '../derive-auto-clock/index.js';
import { deriveAutomatedBreaks } from '../derive-automated-breaks/index.js';
import {
  type RunAutoClockInput,
  runAutoClockSchema,
} from './run-auto-clock.schema.js';

/**
 * Data-access functions for cross-domain reads. The default implementation
 * (`createRunAutoClockDeps`, below) is wired against the real scheduling /
 * org-defaults tables; the scheduler job in `apps/api/src/scheduler/` calls
 * `runAutoClock` for each active practitioner every 5 minutes with it. Tests
 * inject narrow fakes instead.
 */
export interface RunAutoClockDeps {
  getWageAutomationConfig: (input: {
    organizationId: string;
    practitionerId: string;
  }) => Promise<ContractWageAutomationConfig | null>;
  getOrgWageDefaults: (input: {
    organizationId: string;
  }) => Promise<ContractOrgWageDefaults | null>;
  getShiftWindows: (input: {
    organizationId: string;
    practitionerId: string;
    now: Date;
  }) => Promise<ContractShiftWindow[]>;
  getUnpaidBlockedTimeOccurrences: (input: {
    organizationId: string;
    practitionerId: string;
    from: Date;
    to: Date;
  }) => Promise<ContractBlockedTimeOccurrence[]>;
}

export interface RunAutoClockResult {
  clockedIn: TimeEntry | null;
  clockedOut: TimeEntry | null;
  autoBreaksInserted: number;
}

/**
 * Auto-clock scheduler tick for one practitioner (contract §1.5):
 * resolves the automation flags (wage config → org default → false), derives
 * clock-in/clock-out actions from today's resolved shift windows, executes
 * them on time_entry, and on auto clock-out inserts `source='auto'` break
 * rows from unpaid blocked-time occurrences when automatedBreaks resolves on.
 */
const runAutoClockImpl = async (
  db: DbConnection,
  input: RunAutoClockInput,
  deps: RunAutoClockDeps
): Promise<Result<RunAutoClockResult>> => {
  const parsed = runAutoClockSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, practitionerId } = parsed.data;
  const now = parsed.data.now ?? new Date();

  try {
    const [wageConfig, orgDefaults] = await Promise.all([
      deps.getWageAutomationConfig({ organizationId, practitionerId }),
      deps.getOrgWageDefaults({ organizationId }),
    ]);

    const flagsResult = resolveAutomationFlags({ wageConfig, orgDefaults });
    if (!flagsResult.success) return flagsResult;
    const flags = flagsResult.data;

    if (!flags.autoClockIn && !flags.autoClockOut) {
      return ok({ clockedIn: null, clockedOut: null, autoBreaksInserted: 0 });
    }

    const shiftWindows = await deps.getShiftWindows({
      organizationId,
      practitionerId,
      now,
    });

    const openEntry = await db.query.timeEntry.findFirst({
      where: (t, { and: andOp, eq: eqOp, isNull }) =>
        andOp(
          eqOp(t.organizationId, organizationId),
          eqOp(t.practitionerId, practitionerId),
          isNull(t.clockOut)
        ),
    });

    const actionsResult = deriveAutoClock({
      now,
      flags: {
        autoClockIn: flags.autoClockIn,
        autoClockOut: flags.autoClockOut,
      },
      shiftWindows,
      openEntry: openEntry
        ? { id: openEntry.id, clockIn: openEntry.clockIn }
        : null,
    });
    if (!actionsResult.success) return actionsResult;
    const actions = actionsResult.data;

    let clockedOut: TimeEntry | null = null;
    let autoBreaksInserted = 0;

    if (actions.clockOut) {
      const [updated] = await db
        .update(timeEntry)
        .set({ clockOut: actions.clockOut.at, status: 'completed' })
        .where(eq(timeEntry.id, actions.clockOut.timeEntryId))
        .returning();
      clockedOut = updated;

      if (flags.automatedBreaks && updated?.clockOut) {
        const occurrences = await deps.getUnpaidBlockedTimeOccurrences({
          organizationId,
          practitionerId,
          from: updated.clockIn,
          to: updated.clockOut,
        });
        const breaksResult = deriveAutomatedBreaks({
          clockIn: updated.clockIn,
          clockOut: updated.clockOut,
          occurrences,
        });
        if (breaksResult.success && breaksResult.data.length > 0) {
          const inserted = await db
            .insert(timeEntryBreak)
            .values(
              breaksResult.data.map((b) => ({
                timeEntryId: updated.id,
                breakStart: b.breakStart,
                breakEnd: b.breakEnd,
                source: 'auto' as const,
              }))
            )
            .returning();
          autoBreaksInserted = inserted.length;
        }
      }
    }

    let clockedIn: TimeEntry | null = null;
    if (actions.clockIn) {
      const [created] = await db
        .insert(timeEntry)
        .values({
          organizationId,
          practitionerId,
          clockIn: actions.clockIn.at,
          source: 'auto',
          status: 'open',
        })
        .returning();
      clockedIn = created;
    }

    return ok({ clockedIn, clockedOut, autoBreaksInserted });
  } catch (error) {
    logError('timesheets.runAutoClock', error, {
      feature: 'timesheets',
      extra: { organizationId, practitionerId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to run auto-clock')
    );
  }
};

export const runAutoClock = (
  db: DbConnection,
  input: RunAutoClockInput,
  deps: RunAutoClockDeps
) =>
  trackedResult(
    'timesheets.runAutoClock',
    () => withOrgScope((tx) => runAutoClockImpl(tx, input, deps), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        practitionerId: input.practitionerId,
      },
      // This is the inner body of a per-practitioner loop that the scheduler
      // runs every 5 minutes, so a success event here is emitted
      // practitioners × 288 times a day and says nothing a human would read.
      // Left unchecked it dwarfed every other event in the project.
      // Failures still emit (they're rare and actionable), and the scheduler
      // emits one `timesheets.autoClockTick` summary per tick with the
      // aggregate counts.
      trackSuccess: false,
    }
  );

export type RunAutoClockServiceResult = Awaited<
  ReturnType<typeof runAutoClock>
>;

/**
 * Default cross-domain deps for `runAutoClock`, wired against the real
 * scheduling / org-defaults tables (contract §1.1, §1.5):
 *
 * - `getWageAutomationConfig`: reads the practitioner's `practitioner_wage_config`
 *   automation columns; `null` when the row is absent (→ all `workspace_default`).
 * - `getOrgWageDefaults`: reads the `org_defaults` wage_* booleans through the
 *   `getOrgDefaults` resolver (system fallback = `false`).
 * - `getShiftWindows`: resolves the `shift` rows for the prior local day
 *   through now with override semantics (via `listShifts` → `resolveShiftDays`)
 *   and converts minutes-from-midnight to absolute instants in the org's IANA
 *   timezone (`organization.timezone`), matching the availability/calendar
 *   path. Looking back a day keeps a still-open entry's ending window (overnight
 *   shift or a tick that rolled past midnight) visible so it can auto-close.
 * - `getUnpaidBlockedTimeOccurrences`: expands `blocked_time` occurrences
 *   overlapping the window for this practitioner (org-wide blocks included) via
 *   `listBlockedTime`, keeping only unpaid ones (the break signal).
 *
 * The `db` is captured in the closure; the deps run inside the same ambient
 * scope as the `runAutoClock` call (the scheduler wraps each call in
 * `withSystemScope`), so nested `withOrgScope` reads resolve correctly.
 */
export const createRunAutoClockDeps = (db: DbConnection): RunAutoClockDeps => ({
  getWageAutomationConfig: async ({ organizationId, practitionerId }) => {
    const row = await withOrgScope(
      (tx) =>
        tx.query.practitionerWageConfig.findFirst({
          where: and(
            eq(practitionerWageConfig.practitionerId, practitionerId),
            eq(practitionerWageConfig.organizationId, organizationId)
          ),
        }),
      { db }
    );
    if (!row) return null;
    return {
      autoClockIn: row.autoClockIn,
      autoClockOut: row.autoClockOut,
      automatedBreaks: row.automatedBreaks,
    };
  },

  getOrgWageDefaults: async ({ organizationId }) => {
    const result = await getOrgDefaults(db, { organizationId });
    if (!result.success) return null;
    return {
      wageAutoClockIn: result.data.wageAutoClockIn,
      wageAutoClockOut: result.data.wageAutoClockOut,
      wageAutomatedBreaks: result.data.wageAutomatedBreaks,
    };
  },

  getShiftWindows: async ({ organizationId, practitionerId, now }) => {
    // Widen the query to include the prior calendar day. `listShifts`/
    // `resolveShiftDays` only resolve the local days that overlap [from, to];
    // querying {from: now, to: now} yields solely *now's* single local day, so
    // a still-open entry whose ending shift window fell on the previous local
    // day (an overnight shift, or a missed scheduler tick that rolled past
    // midnight) is never seen and the entry never auto-closes. Looking back 24h
    // guarantees that ending window is present in `closableEnds`. A past-day
    // window can never trigger a spurious clock-in — `deriveAutoClock` only
    // opens a window that is currently running (`start <= now < end`).
    const DAY_MS = 24 * 60 * 60 * 1000;
    const from = new Date(now.getTime() - DAY_MS);

    const [orgRow, result] = await Promise.all([
      withOrgScope(
        (tx) =>
          tx.query.organization.findFirst({
            where: eq(organization.id, organizationId),
            columns: { timezone: true },
          }),
        { db }
      ),
      listShifts(db, {
        organizationId,
        practitionerId,
        from,
        to: now,
      }),
    ]);
    if (!result.success) return [];

    // Resolve the day's naive minutes-from-midnight against the organization's
    // IANA timezone (the same conversion the calendar/availability path uses),
    // NOT the server's local zone. Anchoring at server-local midnight fired
    // auto clock-in/out hours off for non-UTC orgs.
    const timeZone = orgRow?.timezone || 'UTC';

    const windows: ContractShiftWindow[] = [];
    for (const day of result.data) {
      if (day.isOff) continue;
      for (const interval of day.intervals) {
        windows.push({
          start: zonedWallTimeToUtc(day.date, interval.startMinutes, timeZone),
          end: zonedWallTimeToUtc(day.date, interval.endMinutes, timeZone),
        });
      }
    }
    return windows;
  },

  getUnpaidBlockedTimeOccurrences: async ({
    organizationId,
    practitionerId,
    from,
    to,
  }) => {
    const result = await listBlockedTime(db, {
      organizationId,
      practitionerId,
      from,
      to,
    });
    if (!result.success) return [];
    return result.data
      .filter((occ) => !occ.paid)
      .map((occ) => ({
        start: occ.startDate,
        end: occ.endDate,
        paid: occ.paid,
      }));
  },
});
