/**
 * Optional resource picks, and the rooms calendar's dead-booking filter.
 *
 * Two changes landed together and neither is covered anywhere else. Both are
 * the silent kind: nothing errors, the UI renders fine, and the clinic finds
 * out when two people walk into the same room.
 *
 * ─── 1. AN OPTIONAL PICK IS NOW A REAL HOLD ───────────────────────────────
 * The booking dialog lets the front desk attach a room to a service whose
 * definition requires none ("this facial happens in Room 2 today"). That used
 * to be impossible to express: `allocateAppointmentResources` reached the
 * zero-cost rollout guard first, the guard returned `EMPTY_RESULT` because no
 * service in the cart carried a requirement row, and `resourceIds` was never
 * read. The booking succeeded holding NOTHING — no error, no warning, and a
 * room the engine went on offering to everybody else.
 *
 * The explicit-picks branch now runs BEFORE that guard, and `allocateExplicit`
 * no longer refuses a category no service requires. So this file pins:
 *   - a requirement-free cart + `resourceIds: [room]` HOLDS that room;
 *   - an optional pick carries ZERO turnaround even when another service in the
 *     cart has a non-zero one — turnaround belongs to the REQUIREMENT, not to
 *     whichever room the operator happened to attach. Holding a spare chair 15
 *     minutes past the appointment because the laser needs a clean-down is an
 *     invented booking constraint;
 *   - the three refusals that must SURVIVE the loosening, asserted on a
 *     requirement-free cart precisely because that is the path the guard used
 *     to make unreachable: another org's id, a deactivated id, and two ids from
 *     one category. A loosened validator that stopped biting here would let a
 *     stale client hand us any resource row in the database;
 *   - THE ROLLOUT-SAFETY GUARANTEE, by MECHANISM. Moving anything ahead of the
 *     zero-cost guard is exactly how that guarantee gets lost, and it cannot be
 *     observed from the outcome (an org with no rooms holds nothing either
 *     way). Counted off drizzle's own query logger, with the TOTAL asserted
 *     non-zero first so the test cannot pass by observing nothing at all.
 *
 * ─── 2. THE ROOMS CALENDAR NO LONGER DRAWS DEAD BOOKINGS ──────────────────
 * `listAppointmentResources` now inner-joins `appointment` and filters on
 * `notDeleted(appointment)` + `activeAppointmentStatuses`. Allocations ARE
 * released when a booking is cancelled, so in theory the filter is redundant —
 * in practice a leaked hold rendered as an OCCUPIED ROOM WITH NO CLICKABLE
 * BOOKING BEHIND IT, in the one view whose entire job is to say which rooms are
 * free. An un-freeable room. The three cases are pinned in ONE window off ONE
 * feed call, and the leaked rows are asserted to still EXIST in the table
 * afterwards, so "hidden by the filter" cannot pass for "never inserted".
 *
 * Deliberately NOT restated here: the auto-vs-manual axis and the partial /
 * empty / busy / soft-deleted pick states (`resource-assignment-modes`,
 * `resource-booking-selection`), the feed's window edges and display fields
 * (`resource-allocations-feed`), and the cart collapsing rules
 * (`resource-cart-allocation`).
 */
import {
  appointment,
  appointmentResource,
  db,
} from '@borradh-workspace/database';
import { createAppointment } from '@borradh-workspace/features/appointments';
import { listAppointmentResources } from '@borradh-workspace/features/resources';
import { and, eq } from 'drizzle-orm';
import {
  seedAppointment,
  seedLead,
  seedOrganization,
  seedUser,
} from './harness.js';
import {
  allocationsFor,
  seedAllocation,
  seedRequirement,
  seedResource,
  seedResourceCategory,
  seedResourceService,
} from './seeds/resources.js';

/** See appointment-double-booking.int-spec.ts for why the fixture is rebased. */
const FIXTURE_EPOCH_MS = Date.UTC(2026, 6, 1); // earliest literal: 2026-07-01
const FUTURE_ANCHOR_MS = (() => {
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  base.setUTCDate(base.getUTCDate() + 14);
  return base.getTime();
})();
const at = (iso: string) =>
  new Date(new Date(iso).getTime() - FIXTURE_EPOCH_MS + FUTURE_ANCHOR_MS);

const MINUTE = 60_000;

const HOUR = {
  ten: {
    startDate: at('2026-07-01T10:00:00.000Z'),
    endDate: at('2026-07-01T11:00:00.000Z'),
  },
  fourteen: {
    startDate: at('2026-07-01T14:00:00.000Z'),
    endDate: at('2026-07-01T15:00:00.000Z'),
  },
};

/** The calendar page the feed tests ask about: one working day, 09:00–17:00. */
const WINDOW = {
  from: at('2026-07-01T09:00:00.000Z'),
  to: at('2026-07-01T17:00:00.000Z'),
};

/* ------------------------------------------------------------------ */
/* World                                                               */
/* ------------------------------------------------------------------ */

interface World {
  organizationId: string;
  assigneeId: string;
  leadId: string;
}

/** A fresh org per test, with the two rows every appointment needs. */
async function seedWorld(): Promise<World> {
  const organizationId = await seedOrganization();
  const assignee = await seedUser();
  return {
    organizationId,
    assigneeId: assignee.id,
    leadId: await seedLead({ organizationId }),
  };
}

interface BookInput {
  title: string;
  startDate: Date;
  endDate: Date;
  serviceId: string;
  resourceIds?: string[];
  /** Omitted ⇒ the console path (`manual`), which is where picks come from. */
  source?: 'booking_form';
}

const book = (world: World, input: BookInput) =>
  createAppointment(db, {
    title: input.title,
    startDate: input.startDate,
    endDate: input.endDate,
    leadId: world.leadId,
    assignedToId: world.assigneeId,
    organizationId: world.organizationId,
    serviceId: input.serviceId,
    resourceIds: input.resourceIds,
    source: input.source,
  });

/** Did a refusal actually roll the appointment row back? */
async function appointmentExists(
  organizationId: string,
  title: string
): Promise<boolean> {
  const rows = await db
    .select({ id: appointment.id })
    .from(appointment)
    .where(
      and(
        eq(appointment.organizationId, organizationId),
        eq(appointment.title, title)
      )
    );
  return rows.length > 0;
}

/** Every allocation row in the org, whichever appointment it belongs to. */
async function orgAllocationCount(organizationId: string): Promise<number> {
  const rows = await db
    .select({ id: appointmentResource.id })
    .from(appointmentResource)
    .where(eq(appointmentResource.organizationId, organizationId));
  return rows.length;
}

/**
 * Record the SQL of every query drizzle runs during `operation`.
 *
 * Swaps drizzle's own query logger (a `NoopLogger` by default) for a collector
 * — the same mechanism `resource-booking-selection.int-spec.ts` uses, kept
 * local rather than shared because it reaches into drizzle internals and each
 * spec should fail loudly on its own if that shape changes.
 *
 * Callers MUST assert the total is non-zero before asserting a filtered count,
 * or a future drizzle that stops consulting `session.logger` would turn "the
 * zero-cost path is real" into "we observed nothing" and pass for the opposite
 * reason.
 */
async function withQueryLog<T>(
  operation: () => Promise<T>
): Promise<{ result: T; queries: string[] }> {
  const session = (
    db as unknown as {
      session: {
        logger: { logQuery: (query: string, params: unknown[]) => void };
      };
    }
  ).session;
  const original = session.logger;
  const queries: string[] = [];
  session.logger = {
    logQuery: (query: string) => {
      queries.push(query);
    },
  };
  try {
    const result = await operation();
    return { result, queries };
  } finally {
    session.logger = original;
  }
}

/* ------------------------------------------------------------------ */

describe('optional resource picks on a requirement-free cart', () => {
  it('HOLDS a room the operator picked for a service that requires nothing', async () => {
    // The regression this exists for: before the explicit-picks branch was
    // moved ahead of the zero-cost guard, this exact call succeeded and held
    // NOTHING. `created.data.resources` was `[]`, `appointment_resource` was
    // empty, and the room stayed on offer to everyone else all afternoon.
    const world = await seedWorld();
    const serviceId = await seedResourceService({
      organizationId: world.organizationId,
      appointmentDuration: 60,
    });
    const categoryId = await seedResourceCategory({
      organizationId: world.organizationId,
      name: 'Rooms',
    });
    const roomId = await seedResource({
      organizationId: world.organizationId,
      categoryId,
      name: 'Room 1',
    });
    // Deliberately NO seedRequirement: the service demands nothing at all, so
    // the zero-cost guard would return before `resourceIds` were ever read.

    const created = await book(world, {
      title: 'Optional room',
      ...HOUR.ten,
      serviceId,
      resourceIds: [roomId],
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error.message);

    expect(created.data.resources).toEqual([
      { categoryId, resourceId: roomId },
    ]);
    expect(created.data.resourceWarnings).toEqual([]);

    // The row, not just the response: the response is computed in memory and
    // could report a hold that was never written.
    const holds = await allocationsFor(created.data.id);
    expect(holds).toHaveLength(1);
    expect(holds[0].resourceId).toBe(roomId);
    expect(holds[0].source).toBe('manual');
    expect(holds[0].startDate.getTime()).toBe(HOUR.ten.startDate.getTime());
    expect(holds[0].endDate.getTime()).toBe(HOUR.ten.endDate.getTime());

    // Nothing else was invented alongside it.
    expect(await orgAllocationCount(world.organizationId)).toBe(1);
  });

  it('gives an optional pick ZERO turnaround while the required category keeps the cart’s', async () => {
    // Turnaround belongs to the REQUIREMENT. The laser needs a 15-minute
    // clean-down; the room the operator attached needs none, and inheriting the
    // laser's would hold the room a quarter of an hour the clinic never asked
    // for — invisible on the appointment, and enough to lose a slot a day.
    const world = await seedWorld();
    const serviceId = await seedResourceService({
      organizationId: world.organizationId,
      appointmentDuration: 60,
      turnaroundMinutes: 15,
    });

    const roomCategoryId = await seedResourceCategory({
      organizationId: world.organizationId,
      name: 'Rooms',
    });
    const roomId = await seedResource({
      organizationId: world.organizationId,
      categoryId: roomCategoryId,
      name: 'Room 1',
    });

    const laserCategoryId = await seedResourceCategory({
      organizationId: world.organizationId,
      name: 'Lasers',
      kind: 'equipment',
    });
    const laserId = await seedResource({
      organizationId: world.organizationId,
      categoryId: laserCategoryId,
      name: 'Laser 1',
    });

    // ONLY the laser is required. The room is the operator's optional extra.
    await seedRequirement({
      organizationId: world.organizationId,
      serviceId,
      categoryId: laserCategoryId,
    });

    const created = await book(world, {
      title: 'Laser plus an optional room',
      ...HOUR.fourteen,
      serviceId,
      resourceIds: [roomId, laserId],
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error.message);

    const holds = await allocationsFor(created.data.id);
    expect(holds).toHaveLength(2);
    const byResource = new Map(holds.map((hold) => [hold.resourceId, hold]));

    const room = byResource.get(roomId);
    expect(room?.source).toBe('manual');
    expect(room?.turnaroundMinutes).toBe(0);
    expect(room?.endDate.getTime()).toBe(HOUR.fourteen.endDate.getTime());

    const laser = byResource.get(laserId);
    expect(laser?.source).toBe('manual');
    expect(laser?.turnaroundMinutes).toBe(15);
    expect(laser?.endDate.getTime()).toBe(
      HOUR.fourteen.endDate.getTime() + 15 * MINUTE
    );
  });

  /**
   * The three refusals asserted on a REQUIREMENT-FREE cart on purpose: that is
   * the path the zero-cost guard used to make unreachable, so it is the path
   * with no prior coverage at all. A validator loosened to accept optional
   * categories must still refuse everything a stale or hostile client can send.
   */
  it("still refuses another org's resource id, with no appointment written", async () => {
    const world = await seedWorld();
    const serviceId = await seedResourceService({
      organizationId: world.organizationId,
      appointmentDuration: 60,
    });

    const otherOrganizationId = await seedOrganization();
    const foreignRoom = await seedResource({
      organizationId: otherOrganizationId,
      categoryId: await seedResourceCategory({
        organizationId: otherOrganizationId,
        name: 'Rooms',
      }),
      name: 'Not our room',
    });

    const created = await book(world, {
      title: 'Foreign room',
      ...HOUR.ten,
      serviceId,
      resourceIds: [foreignRoom],
    });
    expect(created.success).toBe(false);
    if (created.success) throw new Error('expected a validation failure');
    expect(created.error.code).toBe('VALIDATION_ERROR');
    expect(await appointmentExists(world.organizationId, 'Foreign room')).toBe(
      false
    );
    expect(await orgAllocationCount(world.organizationId)).toBe(0);
    // And nothing was written against the victim org either.
    expect(await orgAllocationCount(otherOrganizationId)).toBe(0);
  });

  it('still refuses a DEACTIVATED resource, with no appointment written', async () => {
    const world = await seedWorld();
    const serviceId = await seedResourceService({
      organizationId: world.organizationId,
      appointmentDuration: 60,
    });
    const retiredRoom = await seedResource({
      organizationId: world.organizationId,
      categoryId: await seedResourceCategory({
        organizationId: world.organizationId,
        name: 'Rooms',
      }),
      name: 'Out of service',
      isActive: false,
    });

    const created = await book(world, {
      title: 'Retired room',
      ...HOUR.ten,
      serviceId,
      resourceIds: [retiredRoom],
    });
    expect(created.success).toBe(false);
    if (created.success) throw new Error('expected a validation failure');
    expect(created.error.code).toBe('VALIDATION_ERROR');
    expect(await appointmentExists(world.organizationId, 'Retired room')).toBe(
      false
    );
    expect(await orgAllocationCount(world.organizationId)).toBe(0);
  });

  it('still refuses TWO resources from the same category, with no appointment written', async () => {
    // One hold per CATEGORY is the whole allocation model. Two rooms on one
    // booking is a dialog bug, and accepting it would make the second hold
    // invisible to the picker that produced it.
    const world = await seedWorld();
    const serviceId = await seedResourceService({
      organizationId: world.organizationId,
      appointmentDuration: 60,
    });
    const categoryId = await seedResourceCategory({
      organizationId: world.organizationId,
      name: 'Rooms',
    });
    const roomOne = await seedResource({
      organizationId: world.organizationId,
      categoryId,
      name: 'Room 1',
      sortOrder: 0,
    });
    const roomTwo = await seedResource({
      organizationId: world.organizationId,
      categoryId,
      name: 'Room 2',
      sortOrder: 1,
    });

    const created = await book(world, {
      title: 'Two rooms at once',
      ...HOUR.ten,
      serviceId,
      resourceIds: [roomOne, roomTwo],
    });
    expect(created.success).toBe(false);
    if (created.success) throw new Error('expected a validation failure');
    expect(created.error.code).toBe('VALIDATION_ERROR');
    expect(
      await appointmentExists(world.organizationId, 'Two rooms at once')
    ).toBe(false);
    // Not "the first one was kept and the second refused" — NOTHING was held.
    expect(await orgAllocationCount(world.organizationId)).toBe(0);
  });

  it('costs exactly ONE query against any resource table for an org with no resources and no picks', async () => {
    // THE ROLLOUT-SAFETY GUARANTEE, asserted by mechanism rather than outcome.
    // Moving the explicit-picks branch ahead of the zero-cost guard is exactly
    // how this gets lost, and the OUTCOME cannot detect it: an org with no
    // rooms holds nothing either way. What the guarantee actually promises is
    // ONE indexed lookup that finds nothing — the `service_resource_requirement`
    // select and nothing else. No `resource` read, no `resource_category` read,
    // no `appointment_resource` write, and — the easy one to regress — no
    // `org_defaults` read for the assignment mode.
    const world = await seedWorld();
    const serviceId = await seedResourceService({
      organizationId: world.organizationId,
      appointmentDuration: 60,
    });
    // No categories, no resources, no requirements, no `org_defaults` row: the
    // overwhelming-majority org that has never opened the rooms feature.

    const { result: created, queries } = await withQueryLog(() =>
      book(world, { title: 'Ungated booking', ...HOUR.ten, serviceId })
    );

    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error.message);
    expect(created.data.resources).toEqual([]);
    expect(created.data.resourceWarnings).toEqual([]);
    expect(await orgAllocationCount(world.organizationId)).toBe(0);

    // Guard the instrumentation itself FIRST: if the logger were never called,
    // the filtered count below would be zero and this test would pass for the
    // exact opposite reason.
    expect(queries.length).toBeGreaterThan(0);

    const touchingResources = queries.filter((query) =>
      /resource|org_defaults/i.test(query)
    );
    expect(touchingResources).toHaveLength(1);
    expect(touchingResources[0]).toContain('service_resource_requirement');
  });
});

/* ------------------------------------------------------------------ */

describe('rooms calendar feed — dead bookings are not drawn', () => {
  it('hides holds whose appointment is cancelled or soft-deleted, and keeps the live one', async () => {
    // A hold left behind by a dead booking renders as an occupied room with no
    // clickable booking behind it — a room nobody can free, in the one view
    // whose job is to say which rooms are free.
    const organizationId = await seedOrganization();
    const assignee = await seedUser();
    const leadId = await seedLead({ organizationId });
    const categoryId = await seedResourceCategory({
      organizationId,
      name: 'Rooms',
    });

    // One room per case: `resource_no_overlap` would refuse two of these on the
    // same resource, and separate lanes keep a failure legible.
    const hold = async (roomName: string) => {
      const resourceId = await seedResource({
        organizationId,
        categoryId,
        name: roomName,
      });
      const appointmentId = await seedAppointment({
        organizationId,
        assignedToId: assignee.id,
        leadId,
        title: roomName,
        startDate: at('2026-07-01T10:00:00.000Z'),
        endDate: at('2026-07-01T11:00:00.000Z'),
      });
      const allocationId = await seedAllocation({
        organizationId,
        appointmentId,
        resourceId,
        startDate: at('2026-07-01T10:00:00.000Z'),
        endDate: at('2026-07-01T11:00:00.000Z'),
      });
      return { resourceId, appointmentId, allocationId };
    };

    const live = await hold('Live booking');
    const cancelled = await hold('Cancelled booking');
    const softDeleted = await hold('Soft-deleted booking');

    await db
      .update(appointment)
      .set({ status: 'cancelled' })
      .where(eq(appointment.id, cancelled.appointmentId));

    // `status` deliberately left `booked` — the soft-delete alone must hide it,
    // or the two filters are really one filter wearing two names.
    await db
      .update(appointment)
      .set({ deletedAt: at('2026-07-01T09:30:00.000Z') })
      .where(eq(appointment.id, softDeleted.appointmentId));

    const result = await listAppointmentResources(db, {
      organizationId,
      from: WINDOW.from,
      to: WINDOW.to,
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    expect(result.data.map((row) => row.id)).toEqual([live.allocationId]);
    expect(result.data[0].resourceId).toBe(live.resourceId);
    expect(result.data[0].appointmentId).toBe(live.appointmentId);

    // The two hidden rows are hidden by the FILTER, not absent because they
    // were never written — otherwise this test would pass against a feed that
    // returns the live row for entirely unrelated reasons.
    expect(await orgAllocationCount(organizationId)).toBe(3);
  });
});
