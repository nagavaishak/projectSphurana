import {
  orgDefaults,
  practitioner,
  practitionerWageConfig,
  withDbRetry,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import {
  type DbConnection,
  type Result,
  internalError,
  ok,
} from '../../../shared/index.js';

export interface AutoClockCandidate {
  organizationId: string;
  practitionerId: string;
}

/**
 * Practitioners for whom the 5-minute auto-clock tick can actually do
 * something — i.e. `autoClockIn` OR `autoClockOut` resolves to `true` under
 * the same precedence `resolveAutomationFlags` applies per practitioner:
 * `practitioner_wage_config` → `org_defaults` → `false`.
 *
 * The scheduler used to fan out over EVERY active practitioner and let
 * `runAutoClock` short-circuit after two reads. That is two DB round-trips per
 * practitioner per tick (plus a PostHog event each) for a population that is
 * almost entirely opted out — auto-clock is off by default and stays off
 * unless an org turns it on. Resolving the flags once, in SQL, means an org
 * fleet with auto-clock disabled costs exactly one indexed query per tick
 * instead of 2N round-trips.
 *
 * Note this reads `org_defaults` directly rather than through `getOrgDefaults`:
 * the resolver's fallback for a missing row is `false`, which is the same
 * answer a `LEFT JOIN` miss gives here, and the join keeps this to one query.
 */
const listAutoClockCandidatesImpl = async (
  db: DbConnection
): Promise<Result<AutoClockCandidate[]>> => {
  try {
    // DISTINCT is defensive: a malformed legacy data set must never cause one
    // practitioner to be auto-clocked twice in a single scheduler pass.
    // This is the whole auto-clock tick's discovery step. A dead pooled
    // connection must not turn a momentary Neon/Fly reconnect into a skipped
    // pass when the next scheduled tick is five minutes away. Retry only
    // known-safe transient connection failures; SQL and permission errors
    // still fail immediately.
    const rows = await withDbRetry(() =>
      db
        .selectDistinct({
          organizationId: practitioner.organizationId,
          practitionerId: practitioner.id,
        })
        .from(practitioner)
        .leftJoin(
          practitionerWageConfig,
          and(
            eq(practitionerWageConfig.practitionerId, practitioner.id),
            eq(
              practitionerWageConfig.organizationId,
              practitioner.organizationId
            )
          )
        )
        .leftJoin(
          orgDefaults,
          eq(orgDefaults.organizationId, practitioner.organizationId)
        )
        .where(
          and(
            eq(practitioner.isActive, true),
            or(
              // Explicit practitioner-level opt-in on either direction.
              eq(practitionerWageConfig.autoClockIn, 'enabled'),
              eq(practitionerWageConfig.autoClockOut, 'enabled'),
              // `workspace_default` (or no config row) → the org default.
              and(
                or(
                  isNull(practitionerWageConfig.autoClockIn),
                  eq(practitionerWageConfig.autoClockIn, 'workspace_default')
                ),
                eq(orgDefaults.wageAutoClockIn, true)
              ),
              and(
                or(
                  isNull(practitionerWageConfig.autoClockOut),
                  eq(practitionerWageConfig.autoClockOut, 'workspace_default')
                ),
                eq(orgDefaults.wageAutoClockOut, true)
              )
            )
          )
        )
        .orderBy(sql`1, 2`)
    );

    return ok(rows);
  } catch (error) {
    logError('timesheets.listAutoClockCandidates', error, {
      feature: 'timesheets',
    });
    // Keep the Result message generic, but preserve the database failure for
    // scheduler-level observability and root-cause grouping.
    return internalError('Failed to list auto-clock candidates', error);
  }
};

export const listAutoClockCandidates = (db: DbConnection) =>
  trackedResult('timesheets.listAutoClockCandidates', () =>
    listAutoClockCandidatesImpl(db)
  );

export type ListAutoClockCandidatesResult = Awaited<
  ReturnType<typeof listAutoClockCandidates>
>;
