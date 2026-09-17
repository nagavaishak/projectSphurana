/**
 * Phase 7 §7a — the `resource_no_overlap` DB backstop.
 *
 * Drives raw INSERTs at `appointment_resource` on the real test DB. NO feature
 * service sits between the test and the constraint: the point of this file is
 * to prove the DATABASE refuses the write, so that when (not if) an application
 * check-then-insert races, the room still cannot be double-held.
 *
 * Behaviour locked here:
 *  - Two allocations on the SAME capacity-1 resource whose [start, end) ranges
 *    OVERLAP: the second INSERT is rejected by the exclusion constraint
 *    `resource_no_overlap` (SQLSTATE 23P01). Not "returns a conflict" — the row
 *    physically cannot exist.
 *  - The ranges are HALF-OPEN (`tstzrange` defaults to `[)`), so `[10:00,11:00)`
 *    and `[11:00,12:00)` are adjacent, not overlapping, and both are accepted.
 *    Any off-by-one here would make every back-to-back booking unbookable.
 *  - `allow_overlap = true` opts a row OUT of the constraint's partial index,
 *    which is the staff force-override path AND the capacity > 1 path (a plain
 *    exclusion constraint cannot count to N). The predicate is symmetric: a row
 *    that opted out is invisible to the check in BOTH directions.
 *  - The constraint keys on `resource_id WITH =`, so different resources never
 *    collide with each other at the same instant.
 *  - CONCURRENCY: two overlapping INSERTs issued simultaneously on separate
 *    connections settle as exactly ONE fulfilled and ONE rejected. This is the
 *    assertion that justifies the constraint's existence — the application-layer
 *    "is the room free?" check is racy by construction, and only the DB can
 *    serialise it.
 *  - `btree_gist` is installed (the `resource_id WITH =` operator class needs
 *    it) and the constraint is registered as an EXCLUDE with the
 *    `allow_overlap = false` predicate — asserted directly against the catalog
 *    so the file cannot pass because the constraint was quietly dropped.
 */
import { db } from '@borradh-workspace/database';
import { sql } from 'drizzle-orm';
import {
  seedAppointment,
  seedLead,
  seedOrganization,
  seedUser,
} from './harness.js';
import {
  capturePgError,
  seedAllocation,
  seedResource,
  seedResourceCategory,
  unwrapDriverError,
} from './seeds/resources.js';

/** SQLSTATE 23P01 — exclusion_violation. */
const EXCLUSION_VIOLATION = '23P01';

/**
 * SQLSTATE 40P01 — deadlock_detected.
 *
 * The OTHER way Postgres can settle two simultaneous overlapping inserts. Both
 * backends take index locks while checking the exclusion constraint, and
 * whether one sees the other's conflicting tuple first (23P01) or they block on
 * each other and the deadlock detector picks a victim (40P01) depends on
 * interleaving this test cannot control. Both mean the constraint did its job:
 * one insert survives, one is rejected, and the range invariant holds.
 *
 * The codebase already treats this as expected — `isDeadlock` ships in
 * packages/database/src/constraints.ts for exactly this class of write.
 */
const DEADLOCK_DETECTED = '40P01';

/**
 * The fixture literals below (2026-04-01 …) encode only the RELATIVE time
 * structure the overlap assertions depend on (same-window collisions, adjacent
 * half-open ranges). `at()` rebases the whole fixture onto a fixed near-future
 * anchor computed once from the real clock, shifting every literal by the same
 * delta — intervals are preserved exactly and no allocation is ever in the past,
 * so nothing time-bombs when the wall clock passes the literals. Deterministic
 * within a run (single `FUTURE_ANCHOR_MS`). Same trick as
 * appointment-double-booking.int-spec.ts.
 */
const FIXTURE_EPOCH_MS = Date.UTC(2026, 3, 1); // earliest literal: 2026-04-01
const FUTURE_ANCHOR_MS = (() => {
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  base.setUTCDate(base.getUTCDate() + 14); // comfortably future
  return base.getTime();
})();
const at = (iso: string) =>
  new Date(new Date(iso).getTime() - FIXTURE_EPOCH_MS + FUTURE_ANCHOR_MS);

/**
 * One org with a capacity-1 resource and N distinct appointments to hang
 * allocations off.
 *
 * N appointments, not one: `appointment_resource_unique` is (appointment_id,
 * resource_id), so two allocations on the same resource MUST belong to
 * different appointments — otherwise the unique constraint fires first and the
 * test would pass for the wrong reason (it would never reach the exclusion
 * constraint at all).
 */
async function seedRoomWorld(appointmentCount: number) {
  const organizationId = await seedOrganization();
  const assignee = await seedUser();
  const leadId = await seedLead({ organizationId });
  const categoryId = await seedResourceCategory({ organizationId });
  const resourceId = await seedResource({ organizationId, categoryId });

  const appointmentIds: string[] = [];
  for (let i = 0; i < appointmentCount; i += 1) {
    appointmentIds.push(
      await seedAppointment({
        organizationId,
        assignedToId: assignee.id,
        leadId,
        title: `Allocation holder ${i}`,
      })
    );
  }

  return { organizationId, categoryId, resourceId, appointmentIds };
}

describe('Phase 7 §7a — resource_no_overlap exclusion constraint', () => {
  it('rejects a second allocation overlapping the same capacity-1 resource', async () => {
    const w = await seedRoomWorld(2);

    await seedAllocation({
      organizationId: w.organizationId,
      appointmentId: w.appointmentIds[0],
      resourceId: w.resourceId,
      startDate: at('2026-04-01T10:00:00.000Z'),
      endDate: at('2026-04-01T11:00:00.000Z'),
    });

    // 10:30–11:30 overlaps 10:00–11:00 on the SAME room → the DB must refuse.
    const err = await capturePgError(() =>
      seedAllocation({
        organizationId: w.organizationId,
        appointmentId: w.appointmentIds[1],
        resourceId: w.resourceId,
        startDate: at('2026-04-01T10:30:00.000Z'),
        endDate: at('2026-04-01T11:30:00.000Z'),
      })
    );
    // The SQLSTATE and the constraint name together: this cannot pass because
    // some OTHER constraint (the (appointment_id, resource_id) unique, say)
    // happened to fire.
    expect(err.code).toBe(EXCLUSION_VIOLATION);
    expect(err.message).toMatch(/resource_no_overlap/);
  });

  it('rejects an allocation fully CONTAINED by an existing one', async () => {
    const w = await seedRoomWorld(2);

    await seedAllocation({
      organizationId: w.organizationId,
      appointmentId: w.appointmentIds[0],
      resourceId: w.resourceId,
      startDate: at('2026-04-02T09:00:00.000Z'),
      endDate: at('2026-04-02T12:00:00.000Z'),
    });

    // Containment is a form of overlap `&&` catches; a naive
    // "start >= existing.end OR end <= existing.start" check would too, but a
    // naive "does my start fall in a busy row?" check on the WRONG column would
    // not. Locked here so the range operator can never be swapped for a scalar
    // comparison.
    const err = await capturePgError(() =>
      seedAllocation({
        organizationId: w.organizationId,
        appointmentId: w.appointmentIds[1],
        resourceId: w.resourceId,
        startDate: at('2026-04-02T10:00:00.000Z'),
        endDate: at('2026-04-02T10:30:00.000Z'),
      })
    );
    expect(err.code).toBe(EXCLUSION_VIOLATION);
    expect(err.message).toMatch(/resource_no_overlap/);
  });

  it('accepts ADJACENT half-open ranges — [10:00,11:00) then [11:00,12:00)', async () => {
    const w = await seedRoomWorld(2);

    const first = await seedAllocation({
      organizationId: w.organizationId,
      appointmentId: w.appointmentIds[0],
      resourceId: w.resourceId,
      startDate: at('2026-04-03T10:00:00.000Z'),
      endDate: at('2026-04-03T11:00:00.000Z'),
    });

    // Starts at the exact instant the first ends. `tstzrange(a, b)` is `[a, b)`,
    // so these touch but do not overlap. If this ever throws, every
    // back-to-back booking in the product just became impossible.
    const second = await seedAllocation({
      organizationId: w.organizationId,
      appointmentId: w.appointmentIds[1],
      resourceId: w.resourceId,
      startDate: at('2026-04-03T11:00:00.000Z'),
      endDate: at('2026-04-03T12:00:00.000Z'),
    });

    const rows = await db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM appointment_resource WHERE resource_id = ${w.resourceId}`
    );
    expect(rows[0].count).toBe('2');
    expect(first).not.toBe(second);
  });

  it('allow_overlap = true on the NEW row bypasses the constraint (staff force-override)', async () => {
    const w = await seedRoomWorld(2);

    await seedAllocation({
      organizationId: w.organizationId,
      appointmentId: w.appointmentIds[0],
      resourceId: w.resourceId,
      startDate: at('2026-04-04T10:00:00.000Z'),
      endDate: at('2026-04-04T11:00:00.000Z'),
    });

    // Same room, same window — accepted ONLY because this row opts out of the
    // constraint's partial index. Phorest's model: warn the front desk, don't
    // block them.
    await seedAllocation({
      organizationId: w.organizationId,
      appointmentId: w.appointmentIds[1],
      resourceId: w.resourceId,
      startDate: at('2026-04-04T10:00:00.000Z'),
      endDate: at('2026-04-04T11:00:00.000Z'),
      allowOverlap: true,
      source: 'manual',
    });

    const rows = await db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM appointment_resource WHERE resource_id = ${w.resourceId}`
    );
    expect(rows[0].count).toBe('2');
  });

  it('allow_overlap = true on the EXISTING row also bypasses — the predicate is symmetric', async () => {
    const w = await seedRoomWorld(2);

    // The opted-out row is not in the constraint's index at all, so it cannot
    // conflict with a later strict row either. This is what makes capacity > 1
    // work: every allocation against such a resource sets allow_overlap, and
    // none of them see each other.
    await seedAllocation({
      organizationId: w.organizationId,
      appointmentId: w.appointmentIds[0],
      resourceId: w.resourceId,
      startDate: at('2026-04-05T10:00:00.000Z'),
      endDate: at('2026-04-05T11:00:00.000Z'),
      allowOverlap: true,
    });

    await seedAllocation({
      organizationId: w.organizationId,
      appointmentId: w.appointmentIds[1],
      resourceId: w.resourceId,
      startDate: at('2026-04-05T10:30:00.000Z'),
      endDate: at('2026-04-05T11:30:00.000Z'),
      allowOverlap: false,
    });

    const rows = await db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM appointment_resource WHERE resource_id = ${w.resourceId}`
    );
    expect(rows[0].count).toBe('2');
  });

  it('allows the same window on DIFFERENT resources', async () => {
    const w = await seedRoomWorld(2);
    const otherResourceId = await seedResource({
      organizationId: w.organizationId,
      categoryId: w.categoryId,
      name: 'Room 2',
    });

    await seedAllocation({
      organizationId: w.organizationId,
      appointmentId: w.appointmentIds[0],
      resourceId: w.resourceId,
      startDate: at('2026-04-06T10:00:00.000Z'),
      endDate: at('2026-04-06T11:00:00.000Z'),
    });

    // `resource_id WITH =` — two rooms at 10:00 are not a conflict.
    await seedAllocation({
      organizationId: w.organizationId,
      appointmentId: w.appointmentIds[1],
      resourceId: otherResourceId,
      startDate: at('2026-04-06T10:00:00.000Z'),
      endDate: at('2026-04-06T11:00:00.000Z'),
    });

    const rows = await db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM appointment_resource
          WHERE resource_id IN (${w.resourceId}, ${otherResourceId})`
    );
    expect(rows[0].count).toBe('2');
  });

  it('CONCURRENCY: two simultaneous overlapping INSERTs — exactly one survives', async () => {
    const w = await seedRoomWorld(2);

    // Fired together on separate pooled connections, so both are in flight
    // before either commits — exactly the shape of two online bookings racing
    // for the last free room. An application-layer check-then-insert lets BOTH
    // through here; the exclusion constraint does not.
    const results = await Promise.allSettled([
      seedAllocation({
        organizationId: w.organizationId,
        appointmentId: w.appointmentIds[0],
        resourceId: w.resourceId,
        startDate: at('2026-04-07T14:00:00.000Z'),
        endDate: at('2026-04-07T15:00:00.000Z'),
      }),
      seedAllocation({
        organizationId: w.organizationId,
        appointmentId: w.appointmentIds[1],
        resourceId: w.resourceId,
        startDate: at('2026-04-07T14:30:00.000Z'),
        endDate: at('2026-04-07T15:30:00.000Z'),
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The loser must lose for a reason that means THE CONSTRAINT REJECTED IT,
    // not for an unrelated failure. Two codes qualify and which one appears is
    // a race the test cannot pin: a direct conflict (23P01) or the deadlock
    // detector choosing a victim while both backends hold index locks (40P01).
    // Asserting only 23P01 made this spec fail intermittently on every branch.
    //
    // Narrow, not loosened: a serialization failure, a timeout or any other
    // SQLSTATE still fails here, and the row-count assertion below is what
    // actually proves exactly one allocation survived.
    const reason = unwrapDriverError(
      (rejected[0] as PromiseRejectedResult).reason
    );
    expect([EXCLUSION_VIOLATION, DEADLOCK_DETECTED]).toContain(reason.code);
    // Only a direct conflict names the constraint; a deadlock victim is
    // aborted before it gets that far.
    if (reason.code === EXCLUSION_VIOLATION) {
      expect(reason.message).toMatch(/resource_no_overlap/);
    }

    // And the DB is left holding exactly one allocation, not zero and not two.
    const rows = await db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM appointment_resource WHERE resource_id = ${w.resourceId}`
    );
    expect(rows[0].count).toBe('1');
  });

  it('btree_gist is installed and the constraint is a predicated EXCLUDE', async () => {
    // `resource_id WITH =` needs an equality operator class for a GiST index,
    // which only btree_gist provides. Without the extension the migration would
    // have failed — but a future "clean up unused extensions" migration would
    // silently take the constraint with it, so assert it directly.
    const ext = await db.execute<{ extname: string }>(
      sql`SELECT extname FROM pg_extension WHERE extname = 'btree_gist'`
    );
    expect(ext).toHaveLength(1);

    const con = await db.execute<{ contype: string; def: string }>(
      sql`SELECT c.contype::text AS contype,
                 pg_get_constraintdef(c.oid) AS def
          FROM pg_constraint c
          JOIN pg_class t ON t.oid = c.conrelid
          WHERE t.relname = 'appointment_resource'
            AND c.conname = 'resource_no_overlap'`
    );
    expect(con).toHaveLength(1);
    // 'x' = exclusion constraint.
    expect(con[0].contype).toBe('x');
    expect(con[0].def).toMatch(/EXCLUDE USING gist/);
    expect(con[0].def).toMatch(/resource_id WITH =/);
    expect(con[0].def).toMatch(
      /tstzrange\([^)]*start_date[^)]*end_date[^)]*\) WITH &&/
    );
    // The partial predicate is what makes force-overrides and capacity > 1
    // possible. Drop it and every capacity-2 room breaks.
    // Postgres renders the predicate double-parenthesised
    // (`WHERE ((allow_overlap = false))`), so match loosely on the predicate
    // itself rather than on its exact parenthesisation.
    expect(con[0].def).toMatch(/WHERE .*allow_overlap = false/);
  });
});
