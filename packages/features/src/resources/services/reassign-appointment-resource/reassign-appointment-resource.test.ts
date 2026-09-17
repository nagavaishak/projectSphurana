import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
import { reassignAppointmentResource } from './reassign-appointment-resource.service.js';

/**
 * How a lost room race must surface: CONFLICT, never a 500.
 *
 * `isResourceRaceLoss` recognises THREE shapes, and this service had no test
 * file at all — so the deadlock arm in particular shipped unverified while its
 * sibling in `allocate-appointment-resources.ts` got a dedicated one in the
 * same commit. The failure that would go unnoticed is narrow and nasty: a
 * regression in the cause-chain walk (a drizzle upgrade changing the wrapper
 * shape, say) turns a deadlocked reassignment back into an INTERNAL_ERROR —
 * a 500 at the front desk for two people grabbing the same room, reproducible
 * only under enough concurrency to produce the cycle.
 *
 * The classification happens in TWO places for one error: the impl rethrows so
 * the aborted transaction rolls back cleanly, and the wrapper's `.catch` maps
 * the rethrow to CONFLICT. These tests drive the exported service, so they
 * cover both halves — a rethrow that never got mapped would surface here as an
 * unhandled rejection rather than a Result.
 */

/**
 * The shapes drizzle 0.45.2 actually throws — the SQL text on the outer error,
 * the driver error carrying the SQLSTATE on `.cause`.
 *
 * Built here rather than imported from the sibling suite on purpose: a shared
 * fixture that drifted would weaken both suites at once, and the whole point of
 * these is that they mirror the wire shape rather than a convenient stand-in.
 * A bare `new Error('resource_no_overlap')` would pass a message match and
 * still ship a 500.
 */
const drizzleDeadlock = () =>
  Object.assign(
    new Error(
      'Failed query: delete from "appointment_resource" where ...\nparams: ...'
    ),
    { cause: Object.assign(new Error('deadlock detected'), { code: '40P01' }) }
  );

const drizzleExclusionViolation = () =>
  Object.assign(
    new Error(
      'Failed query: update "appointment_resource" set ...\nparams: ...'
    ),
    {
      cause: Object.assign(
        new Error(
          'conflicting key value violates exclusion constraint "resource_no_overlap"'
        ),
        { code: '23P01', constraint_name: 'resource_no_overlap' }
      ),
    }
  );

const drizzleUniqueViolation = () =>
  Object.assign(
    new Error(
      'Failed query: insert into "appointment_resource" (...) values (...)'
    ),
    {
      cause: Object.assign(
        new Error(
          'duplicate key value violates unique constraint "appointment_resource_unique"'
        ),
        { code: '23505', constraint_name: 'appointment_resource_unique' }
      ),
    }
  );

describe('reassignAppointmentResource — a lost room race is a CONFLICT', () => {
  const mockDb = createMockDatabase();

  /** RELEASE (`resourceId: null`): two reads, then one DELETE. */
  const releaseInput = {
    organizationId: 'org_1',
    appointmentId: 'appt_1',
    categoryId: 'cat_room',
    resourceId: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // `mockClear` clears CALLS but not queued `…Once` implementations, so an
    // unconsumed queue from an earlier test would be served to the next one's
    // first query. Put the chainability back outright.
    for (const method of [
      'select',
      'from',
      'where',
      'innerJoin',
      'limit',
      'for',
      'delete',
      'update',
      'set',
    ] as const) {
      (mockDb[method] as ReturnType<typeof vi.fn>).mockReset().mockReturnThis();
    }
  });

  /**
   * Arrange the RELEASE path so the DELETE is the statement that fails.
   *
   * `.where` is the terminal call of the delete AND a link in both preceding
   * selects, so the rejection has to be queued third. That ordering is the
   * fragile part of this arrangement: if a future read is added before the
   * delete, the rejection would land on a SELECT instead — and because the
   * catch is shape-based rather than statement-based, the test would still see
   * CONFLICT and pass without ever reaching the write. `expect(delete).toHaveBeenCalled()`
   * in every test below is what stops that from going unnoticed.
   */
  const arrangeReleaseFailure = (error: unknown) => {
    // 1. SELECT … FOR UPDATE on the appointment — terminates at `.for`.
    mockDb.for.mockResolvedValueOnce([
      {
        id: 'appt_1',
        startDate: new Date('2026-03-02T10:00:00Z'),
        endDate: new Date('2026-03-02T11:00:00Z'),
      },
    ]);
    // 2. The current hold for this category — terminates at `.limit`.
    //
    // `.limit` is called by BOTH selects: the first chains `.limit(1)` into
    // `.for('update')`, the second ends on it. So the first call has to pass
    // the builder through, and only the second resolves. Queueing the resolve
    // first makes select #1 return a promise where `.for` is expected, and the
    // whole arrangement silently falls apart before the delete.
    mockDb.limit.mockReturnValueOnce(mockDb).mockResolvedValueOnce([
      {
        id: 'ares_1',
        startDate: new Date('2026-03-02T10:00:00Z'),
        endDate: new Date('2026-03-02T11:00:00Z'),
        turnaroundMinutes: 0,
      },
    ]);
    // 3. `.where` passes through for both selects above, then fails the DELETE.
    mockDb.where
      .mockReturnValueOnce(mockDb)
      .mockReturnValueOnce(mockDb)
      .mockRejectedValueOnce(error);
  };

  it('maps a DEADLOCK (40P01) to CONFLICT — the arm with no coverage', async () => {
    arrangeReleaseFailure(drizzleDeadlock());

    const result = await reassignAppointmentResource(
      mockDb as never,
      releaseInput
    );

    expect(
      mockDb.delete,
      'the delete never ran — the failure was arranged on the wrong statement'
    ).toHaveBeenCalled();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.CONFLICT);
  });

  it('maps an EXCLUSION violation (23P01) to CONFLICT', async () => {
    arrangeReleaseFailure(drizzleExclusionViolation());

    const result = await reassignAppointmentResource(
      mockDb as never,
      releaseInput
    );

    expect(mockDb.delete).toHaveBeenCalled();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.CONFLICT);
  });

  it('maps a UNIQUE violation (23505) to CONFLICT', async () => {
    arrangeReleaseFailure(drizzleUniqueViolation());

    const result = await reassignAppointmentResource(
      mockDb as never,
      releaseInput
    );

    expect(mockDb.delete).toHaveBeenCalled();
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.CONFLICT);
  });

  it('leaves an unrelated failure as INTERNAL_ERROR', async () => {
    // The guard is the SQLSTATE on the cause chain, not the message. An error
    // whose text merely mentions a constraint is a real fault, and calling it
    // CONFLICT would tell the front desk to retry something that will never
    // succeed. This is the assertion that proves the other three are narrow.
    arrangeReleaseFailure(
      new Error('connection terminated — resource_no_overlap deadlock detected')
    );

    const result = await reassignAppointmentResource(
      mockDb as never,
      releaseInput
    );

    expect(mockDb.delete).toHaveBeenCalled();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
