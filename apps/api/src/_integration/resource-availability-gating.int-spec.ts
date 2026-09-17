/**
 * Phase 7 §7c — resource availability gating: THE MONEY PATH.
 *
 * Everything else in the resource suite protects an invariant. This file
 * protects the revenue: it is the only place that proves a customer is no
 * longer offered a time the clinic physically cannot run, and — just as
 * importantly — that a clinic which has never created a room sees NOTHING
 * change.
 *
 * Two levels are driven, deliberately:
 *  - The PUBLIC widget path (`getGeneralBookingSlots`) for the headline
 *    behaviours, so the assertion is about what a customer is actually shown
 *    rather than about an internal helper's return value.
 *  - The ENGINE (`loadResourceGateContext` + `hasFreeResourcesFor` /
 *    `pickResourcesFor`) for the boundary cases — turnaround to the minute,
 *    capacity counting, eligibility narrowing, location pinning, DST — where a
 *    30-minute slot grid is too coarse to state the assertion at all. This is
 *    the same code the widget calls; it is not a reimplementation of it.
 *
 * Behaviour locked here:
 *  - GATING IS REAL AND CROSSES PRACTITIONERS. One room, two practitioners:
 *    booking practitioner A at 14:00 removes 14:00 from practitioner B, who is
 *    otherwise completely free. Two rooms: B keeps 14:00 until the second room
 *    goes too, and then a third, idle practitioner loses it as well.
 *  - ROLLOUT SAFETY (the single most important assertion in this file). A
 *    service with ZERO requirement rows is byte-identical before and after
 *    resources exist and are fully held — same slots, same order, and
 *    `loadResourceGateContext` returns null so the gate is never even reached.
 *    A gated service in the SAME org, same window, same practitioner, loses the
 *    slot, so the comparison cannot pass because gating was globally broken.
 *  - TURNAROUND EXTENDS THE HOLD, NOT THE APPOINTMENT. With
 *    `turnaroundMinutes = 15` behind an 11:00 finish, a slot at 11:10 is
 *    blocked and 11:15 is free — and the practitioner is still offerable at
 *    11:00 for a service that needs no room.
 *  - ELIGIBILITY ZERO-ROWS MEANS "ANY". Not "none" — inverting it would make
 *    every gated slot unbookable for every org that never restricted a service
 *    to named rooms, i.e. almost all of them. With rows present, only those
 *    resources qualify and the slot vanishes even while other rooms sit idle.
 *  - CAPACITY COUNTS. A capacity-2 room takes two concurrent bookings and
 *    refuses the third; the third appointment is not created at all.
 *  - Inactive / soft-deleted resources are never allocated, and a category
 *    containing only those refuses an online booking.
 *  - A resource pinned to location A is not offered for a location-B booking; a
 *    location-LESS resource is offered at both.
 *  - Two required categories are an AND: the slot is offered only when both
 *    have something free.
 *  - TIME ZONES ARE WALL-CLOCK. A Dublin resource's "09:00–17:00" resolves to
 *    08:00Z in IST and 09:00Z in GMT — asserted ACROSS the October DST
 *    boundary, where a naive UTC reading silently shifts every room's day by an
 *    hour for half the year.
 */
import {
  appointment,
  appointmentResource,
  db,
  organization,
} from '@borradh-workspace/database';
import { createAppointment } from '@borradh-workspace/features/appointments';
import {
  SLOTS_CACHE_PREFIX,
  getGeneralBookingSlots,
} from '@borradh-workspace/features/booking-forms';
import {
  type ResourceGateContext,
  hasFreeResourcesFor,
  loadResourceGateContext,
  resolveResourceAvailability,
} from '@borradh-workspace/features/scheduling';
import { getRedis } from '@borradh-workspace/redis';
import { and, eq } from 'drizzle-orm';
import {
  seedBookablePractitioner,
  seedLead,
  seedLocation,
  seedOrganization,
  seedUser,
} from './harness.js';
import {
  seedEligibility,
  seedRequirement,
  seedResource,
  seedResourceCategory,
  seedResourceLocation,
  seedResourceService,
} from './seeds/resources.js';

/**
 * The fixture literals below (2026-05-01 …) encode only the RELATIVE time
 * structure the gating assertions depend on. `at()` rebases them onto a fixed
 * near-future anchor computed once from the real clock, so no booking is ever
 * in the past (create-appointment's Phase 3 backstop refuses those, and
 * `generateSlots` drops any slot that has already started). Same trick as
 * appointment-double-booking.int-spec.ts.
 *
 * The DST test at the bottom deliberately does NOT use this: rebasing a fixture
 * by an arbitrary delta would move it off the transition it exists to straddle.
 */
const FIXTURE_EPOCH_MS = Date.UTC(2026, 4, 1); // earliest literal: 2026-05-01
const FUTURE_ANCHOR_MS = (() => {
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  base.setUTCDate(base.getUTCDate() + 14); // comfortably future, past the grace
  return base.getTime();
})();
const at = (iso: string) =>
  new Date(new Date(iso).getTime() - FIXTURE_EPOCH_MS + FUTURE_ANCHOR_MS);

/** The whole fixture day, as the window every slot query asks about. */
const DAY_START = at('2026-05-01T00:00:00.000Z');
const DAY_END = at('2026-05-02T00:00:00.000Z');

interface Venue {
  organizationId: string;
  slug: string;
  leadId: string;
  /** Practitioner ids, in creation order. */
  practitionerIds: string[];
  /** A distinct assignee user per practitioner — see `bookOnline`. */
  assigneeIds: string[];
}

/**
 * An org that can actually be booked: a slug (the public widget resolves by
 * it), N bookable practitioners with all-day shifts, and N assignee users.
 *
 * One assignee PER practitioner, not one shared: `hasOverlappingAppointment`
 * keys on `assignedToId` as well as `practitionerId`, so two same-time bookings
 * sharing an assignee would be refused as an ASSIGNEE clash and the room gate —
 * the thing under test — would never be reached.
 */
async function seedVenue(
  practitionerCount = 1,
  overrides: { timezone?: string } = {}
): Promise<Venue> {
  const organizationId = await seedOrganization(
    overrides.timezone ? { timezone: overrides.timezone } : {}
  );
  const [org] = await db
    .select({ slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, organizationId));

  const practitionerIds: string[] = [];
  const assigneeIds: string[] = [];
  for (let i = 0; i < practitionerCount; i += 1) {
    practitionerIds.push(
      await seedBookablePractitioner({
        organizationId,
        name: `Practitioner ${i + 1}`,
      })
    );
    assigneeIds.push((await seedUser()).id);
  }

  return {
    organizationId,
    slug: org.slug,
    leadId: await seedLead({ organizationId }),
    practitionerIds,
    assigneeIds,
  };
}

/**
 * Ask the PUBLIC booking widget for a service's slots on the fixture day.
 *
 * The endpoint memoises its answer in Redis for 45 seconds
 * (`SLOTS_CACHE_TTL_SECONDS`) — a real optimisation for a page that is hit on
 * every load, and safe in production because the DB constraint still refuses a
 * cached-but-taken slot at write time. It is fatal to a test that books and
 * then re-reads within the same second, which would otherwise assert against
 * the PRE-booking answer and pass no matter what gating did. The cache keys are
 * cleared here so every read below is a genuine recompute.
 */
async function slotsFor(
  venue: Venue,
  serviceId: string,
  practitionerId?: string
) {
  // Clear the slot cache between reads.
  //
  // The PREFIX is imported, never spelled here. It used to be a hardcoded
  // 'booking:slots:v1*' and the service moved to v2 when the key gained a
  // branch — so this cleared NOTHING, the second read was served the
  // pre-booking slot list, and three tests on this file failed in a way that
  // read as "resource gating does not remove slots". A phantom bug on the
  // money path, caused entirely by a stale string in a test helper.
  const redis = getRedis();
  const keys = await redis.keys(`${SLOTS_CACHE_PREFIX}*`);
  if (keys.length > 0) await redis.del(...keys);

  const result = await getGeneralBookingSlots(db, {
    organizationSlug: venue.slug,
    serviceId,
    startDate: DAY_START,
    endDate: DAY_END,
    practitionerId,
  });
  if (!result.success) {
    throw new Error(`slot query failed: ${result.error.message}`);
  }
  return result.data;
}

/** ISO start times of the merged slot list — the shape a comparison reads on. */
const startTimes = (response: { slots: { startTime: Date }[] }) =>
  response.slots.map((slot) => slot.startTime.toISOString());

/** Start times offered for ONE practitioner in the per-practitioner breakdown. */
function startTimesFor(
  response: {
    byPractitioner?: {
      practitioner: { id: string };
      slots: { startTime: Date }[];
    }[];
  },
  practitionerId: string
): string[] {
  const entry = response.byPractitioner?.find(
    (row) => row.practitioner.id === practitionerId
  );
  return (entry?.slots ?? []).map((slot) => slot.startTime.toISOString());
}

/**
 * Book through the ONLINE path (`source: 'booking_form'`), which is the one
 * that hard-blocks on an unavailable resource. The default source is `manual`,
 * which deliberately warns instead — using it here would make every "refused"
 * assertion below pass vacuously.
 */
const bookOnline = (
  venue: Venue,
  input: {
    serviceId: string;
    practitionerIndex: number;
    startDate: Date;
    endDate: Date;
    title?: string;
  }
) =>
  createAppointment(db, {
    title: input.title ?? 'Online booking',
    startDate: input.startDate,
    endDate: input.endDate,
    leadId: venue.leadId,
    assignedToId: venue.assigneeIds[input.practitionerIndex],
    practitionerId: venue.practitionerIds[input.practitionerIndex],
    organizationId: venue.organizationId,
    serviceId: input.serviceId,
    source: 'booking_form',
  });

/**
 * Load the real gate context for a service over the fixture day.
 *
 * This is the exact call `computePractitionerSlots` makes on the public widget;
 * driving it directly is what lets the boundary tests below state a 5-minute
 * assertion that a 30-minute slot grid cannot express.
 */
const gateFor = (
  organizationId: string,
  serviceIds: string[],
  extra: { locationId?: string | null; timeZone?: string } = {}
) =>
  loadResourceGateContext(db, {
    organizationId,
    serviceIds,
    from: DAY_START,
    to: DAY_END,
    timeZone: extra.timeZone ?? 'UTC',
    locationId: extra.locationId,
  });

/** `loadResourceGateContext` may legitimately return null; these tests may not. */
function requireGate(ctx: ResourceGateContext | null): ResourceGateContext {
  if (ctx === null) {
    throw new Error(
      'expected a resource gate context — the requirement rows were not seeded'
    );
  }
  return ctx;
}

describe('Phase 7 §7c — resource availability gating (the money path)', () => {
  it('1 room, 2 practitioners: booking A at 14:00 removes 14:00 from B', async () => {
    const venue = await seedVenue(2);
    const serviceId = await seedResourceService({
      organizationId: venue.organizationId,
      appointmentDuration: 60,
    });
    const categoryId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Rooms',
    });
    await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Room 1',
    });
    await seedRequirement({
      organizationId: venue.organizationId,
      serviceId,
      categoryId,
    });

    const before = await slotsFor(venue, serviceId);
    const fourteen = at('2026-05-01T14:00:00.000Z').toISOString();
    expect(startTimesFor(before, venue.practitionerIds[0])).toContain(fourteen);
    expect(startTimesFor(before, venue.practitionerIds[1])).toContain(fourteen);

    const booked = await bookOnline(venue, {
      serviceId,
      practitionerIndex: 0,
      startDate: at('2026-05-01T14:00:00.000Z'),
      endDate: at('2026-05-01T15:00:00.000Z'),
    });
    expect(booked.success).toBe(true);
    if (!booked.success) throw new Error(booked.error.message);
    // The booking really did take the room — otherwise the assertion below
    // would be measuring the practitioner-busy check, not the gate.
    expect(booked.data.resources).toHaveLength(1);

    const after = await slotsFor(venue, serviceId);
    // Practitioner B is completely idle. The ONLY reason 14:00 can be gone is
    // that the single room is held.
    expect(startTimesFor(after, venue.practitionerIds[1])).not.toContain(
      fourteen
    );
    // …and B has not simply been dropped from the page: other times remain.
    expect(
      startTimesFor(after, venue.practitionerIds[1]).length
    ).toBeGreaterThan(0);
  });

  it('2 rooms: B keeps 14:00 until both are taken, then an idle third loses it too', async () => {
    const venue = await seedVenue(3);
    const serviceId = await seedResourceService({
      organizationId: venue.organizationId,
      appointmentDuration: 60,
    });
    const categoryId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Rooms',
    });
    for (const name of ['Room 1', 'Room 2']) {
      await seedResource({
        organizationId: venue.organizationId,
        categoryId,
        name,
      });
    }
    await seedRequirement({
      organizationId: venue.organizationId,
      serviceId,
      categoryId,
    });

    const fourteen = at('2026-05-01T14:00:00.000Z').toISOString();

    const first = await bookOnline(venue, {
      serviceId,
      practitionerIndex: 0,
      startDate: at('2026-05-01T14:00:00.000Z'),
      endDate: at('2026-05-01T15:00:00.000Z'),
      title: 'Room 1 taken',
    });
    expect(first.success).toBe(true);

    // One of two rooms gone — practitioners B and C keep the slot.
    const afterOne = await slotsFor(venue, serviceId);
    expect(startTimesFor(afterOne, venue.practitionerIds[1])).toContain(
      fourteen
    );
    expect(startTimesFor(afterOne, venue.practitionerIds[2])).toContain(
      fourteen
    );

    const second = await bookOnline(venue, {
      serviceId,
      practitionerIndex: 1,
      startDate: at('2026-05-01T14:00:00.000Z'),
      endDate: at('2026-05-01T15:00:00.000Z'),
      title: 'Room 2 taken',
    });
    expect(second.success).toBe(true);
    if (!second.success) throw new Error(second.error.message);
    // The two bookings must be holding DIFFERENT rooms, or "both taken" is a
    // fiction and the next assertion proves nothing.
    if (!first.success) throw new Error(first.error.message);
    expect(second.data.resources[0].resourceId).not.toBe(
      first.data.resources[0].resourceId
    );

    // Practitioner C has no appointment at all; both rooms are now held.
    const afterTwo = await slotsFor(venue, serviceId);
    expect(startTimesFor(afterTwo, venue.practitionerIds[2])).not.toContain(
      fourteen
    );
  });

  it('ROLLOUT SAFETY: a service with zero requirements is byte-identical before and after resources exist', async () => {
    const venue = await seedVenue(1);
    // The service under test. It never gets a requirement row.
    const ungatedId = await seedResourceService({
      organizationId: venue.organizationId,
      name: 'Ungated service',
      appointmentDuration: 60,
    });

    const baseline = startTimes(await slotsFor(venue, ungatedId));
    expect(baseline.length).toBeGreaterThan(0);
    expect(baseline).toContain(at('2026-05-01T14:00:00.000Z').toISOString());

    // ── Now the org discovers rooms. A DIFFERENT service is gated, and the
    // only room is held all day by a console booking. That booking carries NO
    // practitionerId, so it blocks nobody's calendar — the practitioner's own
    // availability is therefore identical either side of this, and any change
    // in the ungated list could only come from the resource gate.
    const gatedId = await seedResourceService({
      organizationId: venue.organizationId,
      name: 'Gated service',
      appointmentDuration: 60,
    });
    const categoryId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Rooms',
    });
    await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'The only room',
    });
    await seedRequirement({
      organizationId: venue.organizationId,
      serviceId: gatedId,
      categoryId,
    });

    const hog = await createAppointment(db, {
      title: 'Holds the room all day',
      startDate: at('2026-05-01T00:00:00.000Z'),
      endDate: at('2026-05-02T00:00:00.000Z'),
      leadId: venue.leadId,
      assignedToId: venue.assigneeIds[0],
      organizationId: venue.organizationId,
      serviceId: gatedId,
      source: 'manual',
    });
    expect(hog.success).toBe(true);
    if (!hog.success) throw new Error(hog.error.message);
    expect(hog.data.resources).toHaveLength(1);

    // The control: the GATED service has lost its whole day. Without this the
    // equality below could pass simply because gating never runs at all.
    expect(startTimes(await slotsFor(venue, gatedId))).toEqual([]);

    // The guarantee: byte-identical. Same slots, same order.
    expect(startTimes(await slotsFor(venue, ungatedId))).toEqual(baseline);

    // …and the reason it is identical: the loader short-circuits on its first
    // (indexed, empty) requirement lookup, so nothing downstream ever runs.
    expect(await gateFor(venue.organizationId, [ungatedId])).toBeNull();
  });

  it('turnaround boundary: end + 10min is blocked, end + 15min is free', async () => {
    const venue = await seedVenue(1);
    const serviceId = await seedResourceService({
      organizationId: venue.organizationId,
      appointmentDuration: 60,
      turnaroundMinutes: 15,
    });
    const categoryId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Rooms',
    });
    await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Room 1',
    });
    await seedRequirement({
      organizationId: venue.organizationId,
      serviceId,
      categoryId,
    });

    const booked = await bookOnline(venue, {
      serviceId,
      practitionerIndex: 0,
      startDate: at('2026-05-01T10:00:00.000Z'),
      endDate: at('2026-05-01T11:00:00.000Z'),
    });
    expect(booked.success).toBe(true);

    // The hold runs past the appointment by the cleanup tail: [10:00, 11:15).
    const [hold] = await db
      .select({
        startDate: appointmentResource.startDate,
        endDate: appointmentResource.endDate,
        turnaroundMinutes: appointmentResource.turnaroundMinutes,
      })
      .from(appointmentResource)
      .where(eq(appointmentResource.organizationId, venue.organizationId));
    expect(hold.endDate.toISOString()).toBe(
      at('2026-05-01T11:15:00.000Z').toISOString()
    );
    expect(hold.turnaroundMinutes).toBe(15);
    // …and the APPOINTMENT itself still ends at 11:00 — turnaround extends the
    // hold, never the booking.
    const [appt] = await db
      .select({ endDate: appointment.endDate })
      .from(appointment)
      .where(eq(appointment.organizationId, venue.organizationId));
    expect(appt.endDate.toISOString()).toBe(
      at('2026-05-01T11:00:00.000Z').toISOString()
    );

    const ctx = requireGate(await gateFor(venue.organizationId, [serviceId]));

    // 11:10 still lands inside the cleanup tail.
    expect(
      hasFreeResourcesFor(
        ctx,
        at('2026-05-01T11:10:00.000Z'),
        at('2026-05-01T12:10:00.000Z')
      )
    ).toBe(false);

    // 11:15 is exactly the tail's end — half-open, so it is free.
    expect(
      hasFreeResourcesFor(
        ctx,
        at('2026-05-01T11:15:00.000Z'),
        at('2026-05-01T12:15:00.000Z')
      )
    ).toBe(true);
  });

  it('turnaround does NOT block the practitioner: a room-less service is still offerable at 11:00', async () => {
    const venue = await seedVenue(1);
    const gatedId = await seedResourceService({
      organizationId: venue.organizationId,
      name: 'Needs a room',
      appointmentDuration: 60,
      turnaroundMinutes: 15,
    });
    const roomlessId = await seedResourceService({
      organizationId: venue.organizationId,
      name: 'Needs nothing',
      appointmentDuration: 30,
    });
    const categoryId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Rooms',
    });
    await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Room 1',
    });
    await seedRequirement({
      organizationId: venue.organizationId,
      serviceId: gatedId,
      categoryId,
    });

    const booked = await bookOnline(venue, {
      serviceId: gatedId,
      practitionerIndex: 0,
      startDate: at('2026-05-01T10:00:00.000Z'),
      endDate: at('2026-05-01T11:00:00.000Z'),
    });
    expect(booked.success).toBe(true);

    const eleven = at('2026-05-01T11:00:00.000Z').toISOString();

    // The practitioner's own calendar is free from 11:00 — the 15 minutes of
    // room cleanup are the ROOM's, not theirs.
    expect(startTimes(await slotsFor(venue, roomlessId))).toContain(eleven);

    // The gated service, by contrast, cannot start at 11:00: the room is still
    // being cleaned until 11:15.
    expect(startTimes(await slotsFor(venue, gatedId))).not.toContain(eleven);
  });

  it('eligibility zero-rows means EVERY resource in the category qualifies', async () => {
    const venue = await seedVenue(1);
    const serviceId = await seedResourceService({
      organizationId: venue.organizationId,
      appointmentDuration: 60,
    });
    const categoryId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Rooms',
    });
    const roomA = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Room A',
      sortOrder: 0,
    });
    const roomB = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Room B',
      sortOrder: 1,
    });
    await seedRequirement({
      organizationId: venue.organizationId,
      serviceId,
      categoryId,
    });
    // Deliberately NO seedEligibility call. Zero rows is the default, and it
    // must read as "any", not "none".

    const ctx = requireGate(await gateFor(venue.organizationId, [serviceId]));
    expect(ctx.requirements).toHaveLength(1);
    expect(ctx.requirements[0].eligibleResourceIds).toEqual([]);
    expect(ctx.resourcesByCategory.get(categoryId)).toEqual([roomA, roomB]);

    // Take Room A out. Room B was never named anywhere, so if zero rows were
    // being read as "nothing qualifies" this would now be false.
    const hog = await createAppointment(db, {
      title: 'Holds Room A',
      startDate: at('2026-05-01T14:00:00.000Z'),
      endDate: at('2026-05-01T15:00:00.000Z'),
      leadId: venue.leadId,
      assignedToId: venue.assigneeIds[0],
      organizationId: venue.organizationId,
      serviceId,
      resourceIds: [roomA],
      source: 'manual',
    });
    expect(hog.success).toBe(true);

    const afterCtx = requireGate(
      await gateFor(venue.organizationId, [serviceId])
    );
    expect(
      hasFreeResourcesFor(
        afterCtx,
        at('2026-05-01T14:00:00.000Z'),
        at('2026-05-01T15:00:00.000Z')
      )
    ).toBe(true);
  });

  it('eligibility rows present: the slot vanishes even though other rooms are free', async () => {
    const venue = await seedVenue(1);
    const serviceId = await seedResourceService({
      organizationId: venue.organizationId,
      appointmentDuration: 60,
    });
    const categoryId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Lasers',
      kind: 'equipment',
    });
    const laserA = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Laser A',
      sortOrder: 0,
    });
    const laserB = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Laser B',
      sortOrder: 1,
    });
    const laserC = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Laser C',
      sortOrder: 2,
    });
    await seedRequirement({
      organizationId: venue.organizationId,
      serviceId,
      categoryId,
    });
    // Only Laser A may run this service.
    await seedEligibility({
      organizationId: venue.organizationId,
      serviceId,
      resourceId: laserA,
    });

    const ctx = requireGate(await gateFor(venue.organizationId, [serviceId]));
    expect(ctx.requirements[0].eligibleResourceIds).toEqual([laserA]);
    // The other two exist and are perfectly free — they are simply not allowed.
    expect(ctx.resourcesByCategory.get(categoryId)).toEqual([
      laserA,
      laserB,
      laserC,
    ]);

    const fourteen = at('2026-05-01T14:00:00.000Z').toISOString();
    expect(startTimes(await slotsFor(venue, serviceId))).toContain(fourteen);

    const hog = await createAppointment(db, {
      title: 'Holds Laser A',
      startDate: at('2026-05-01T14:00:00.000Z'),
      endDate: at('2026-05-01T15:00:00.000Z'),
      leadId: venue.leadId,
      assignedToId: venue.assigneeIds[0],
      organizationId: venue.organizationId,
      serviceId,
      source: 'manual',
    });
    expect(hog.success).toBe(true);
    if (!hog.success) throw new Error(hog.error.message);
    expect(hog.data.resources[0].resourceId).toBe(laserA);

    // Two idle lasers in the same category, and the slot is still gone.
    expect(startTimes(await slotsFor(venue, serviceId))).not.toContain(
      fourteen
    );
  });

  it('capacity = 2: two concurrent bookings succeed, the third is refused and never created', async () => {
    const venue = await seedVenue(3);
    const serviceId = await seedResourceService({
      organizationId: venue.organizationId,
      appointmentDuration: 60,
    });
    const categoryId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Double room',
    });
    await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Room 1 (2 beds)',
      capacity: 2,
    });
    await seedRequirement({
      organizationId: venue.organizationId,
      serviceId,
      categoryId,
    });

    const slot = {
      startDate: at('2026-05-01T14:00:00.000Z'),
      endDate: at('2026-05-01T15:00:00.000Z'),
    };

    const first = await bookOnline(venue, {
      serviceId,
      practitionerIndex: 0,
      ...slot,
      title: 'Bed 1',
    });
    expect(first.success).toBe(true);

    const second = await bookOnline(venue, {
      serviceId,
      practitionerIndex: 1,
      ...slot,
      title: 'Bed 2',
    });
    expect(second.success).toBe(true);

    // Capacity 2 opts every allocation out of `resource_no_overlap` — an
    // exclusion constraint cannot count to N, so the engine's count is the
    // enforcement point and the rows must carry the opt-out to exist at all.
    const holds = await db
      .select({ allowOverlap: appointmentResource.allowOverlap })
      .from(appointmentResource)
      .where(eq(appointmentResource.organizationId, venue.organizationId));
    expect(holds).toHaveLength(2);
    expect(holds.every((hold) => hold.allowOverlap)).toBe(true);

    const third = await bookOnline(venue, {
      serviceId,
      practitionerIndex: 2,
      ...slot,
      title: 'Bed 3 — must be refused',
    });
    expect(third.success).toBe(false);
    if (third.success)
      throw new Error('expected the third booking to be gated');
    expect(third.error.code).toBe('CONFLICT');

    // The refusal is not cosmetic: the appointment was rolled back.
    const rows = await db
      .select({ id: appointment.id })
      .from(appointment)
      .where(
        and(
          eq(appointment.organizationId, venue.organizationId),
          eq(appointment.title, 'Bed 3 — must be refused')
        )
      );
    expect(rows).toEqual([]);
  });

  it('inactive and soft-deleted resources are never allocated', async () => {
    const venue = await seedVenue(2);
    const serviceId = await seedResourceService({
      organizationId: venue.organizationId,
      appointmentDuration: 60,
    });
    const categoryId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Rooms',
    });
    await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Deactivated room',
      isActive: false,
      sortOrder: 0,
    });
    await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Deleted room',
      deletedAt: new Date(),
      sortOrder: 1,
    });
    const liveRoom = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'The live room',
      sortOrder: 2,
    });
    await seedRequirement({
      organizationId: venue.organizationId,
      serviceId,
      categoryId,
    });

    // Only the live room is even a candidate.
    const ctx = requireGate(await gateFor(venue.organizationId, [serviceId]));
    expect(ctx.resourcesByCategory.get(categoryId)).toEqual([liveRoom]);

    const booked = await bookOnline(venue, {
      serviceId,
      practitionerIndex: 0,
      startDate: at('2026-05-01T14:00:00.000Z'),
      endDate: at('2026-05-01T15:00:00.000Z'),
    });
    expect(booked.success).toBe(true);
    if (!booked.success) throw new Error(booked.error.message);
    expect(booked.data.resources.map((row) => row.resourceId)).toEqual([
      liveRoom,
    ]);

    // With the live room gone too, the category has nothing usable and an
    // online booking is refused rather than silently allocating a dead row.
    const second = await bookOnline(venue, {
      serviceId,
      practitionerIndex: 1,
      startDate: at('2026-05-01T14:00:00.000Z'),
      endDate: at('2026-05-01T15:00:00.000Z'),
      title: 'No usable room',
    });
    expect(second.success).toBe(false);
    if (second.success) throw new Error('expected a refusal');
    expect(second.error.code).toBe('CONFLICT');
  });

  it('multi-location: a room pinned to location A is not offered for location B', async () => {
    const venue = await seedVenue(1);
    const serviceId = await seedResourceService({
      organizationId: venue.organizationId,
      appointmentDuration: 60,
    });
    const locationA = await seedResourceLocation({
      organizationId: venue.organizationId,
      name: 'Branch A',
      isPrimary: true,
    });
    const locationB = await seedResourceLocation({
      organizationId: venue.organizationId,
      name: 'Branch B',
    });
    const categoryId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Rooms',
    });
    const pinnedToA = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Room A1',
      locationId: locationA,
    });
    await seedRequirement({
      organizationId: venue.organizationId,
      serviceId,
      categoryId,
    });

    const atA = requireGate(
      await gateFor(venue.organizationId, [serviceId], {
        locationId: locationA,
      })
    );
    expect(atA.resourcesByCategory.get(categoryId)).toEqual([pinnedToA]);

    // Branch B has nothing in this category, so it is UNGATED there — not
    // unbookable.
    //
    // ⚠️ THIS ASSERTION WAS DELIBERATELY REVERSED. It previously required
    // `hasFreeResourcesFor(atB, …) === false`: "the clinic said this service
    // needs a room, Branch B has no room, so Branch B cannot run it." That is
    // a defensible reading and it is not the one we shipped. See D1 in
    // docs/plans/rooms-branch-scoping-handoff.md.
    //
    // What decided it: requirements are ORG-WIDE and resources are
    // BRANCH-filtered, so under the old rule an org that configures rooms at
    // its first branch and then opens a second one finds every gated service
    // silently unbookable at the new branch — an empty calendar, no error,
    // nothing to diagnose. And the gate exists to stop a scarce resource being
    // allocated twice; where the branch has no such resource the constraint is
    // vacuous, so there is nothing to oversell.
    //
    // The org-wide rule this now matches is stated twice elsewhere in this
    // file: a soft-deleted category degrades to ungated rather than unsellable,
    // and zero eligibility rows widen rather than narrow.
    expect(
      await gateFor(venue.organizationId, [serviceId], {
        locationId: locationB,
      })
    ).toBeNull();

    // A location-LESS resource (a trolley-mounted device) IS offered at both,
    // mirroring how a null-location shift row applies everywhere.
    const roving = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Roving trolley',
      locationId: null,
      sortOrder: 5,
    });
    const atBAgain = requireGate(
      await gateFor(venue.organizationId, [serviceId], {
        locationId: locationB,
      })
    );
    expect(atBAgain.resourcesByCategory.get(categoryId)).toEqual([roving]);
    expect(
      hasFreeResourcesFor(
        atBAgain,
        at('2026-05-01T14:00:00.000Z'),
        at('2026-05-01T15:00:00.000Z')
      )
    ).toBe(true);
  });

  it('two required categories are an AND: offered only when BOTH have something free', async () => {
    const venue = await seedVenue(2);
    const serviceId = await seedResourceService({
      organizationId: venue.organizationId,
      appointmentDuration: 60,
    });
    const roomsId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Rooms',
    });
    const lasersId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Lasers',
      kind: 'equipment',
    });
    const room = await seedResource({
      organizationId: venue.organizationId,
      categoryId: roomsId,
      name: 'Room 1',
    });
    const laser = await seedResource({
      organizationId: venue.organizationId,
      categoryId: lasersId,
      name: 'Laser 1',
    });
    for (const categoryId of [roomsId, lasersId]) {
      await seedRequirement({
        organizationId: venue.organizationId,
        serviceId,
        categoryId,
      });
    }

    const fourteen = at('2026-05-01T14:00:00.000Z').toISOString();
    expect(startTimes(await slotsFor(venue, serviceId))).toContain(fourteen);

    // A booking takes ONE of each — proving both categories are held per
    // appointment, not just the first.
    const booked = await bookOnline(venue, {
      serviceId,
      practitionerIndex: 0,
      startDate: at('2026-05-01T14:00:00.000Z'),
      endDate: at('2026-05-01T15:00:00.000Z'),
    });
    expect(booked.success).toBe(true);
    if (!booked.success) throw new Error(booked.error.message);
    expect(booked.data.resources.map((row) => row.resourceId).sort()).toEqual(
      [room, laser].sort()
    );

    // A second room appears, but the single laser is still held: the AND fails.
    await seedResource({
      organizationId: venue.organizationId,
      categoryId: roomsId,
      name: 'Room 2',
      sortOrder: 1,
    });
    const ctx = requireGate(await gateFor(venue.organizationId, [serviceId]));
    expect(
      hasFreeResourcesFor(
        ctx,
        at('2026-05-01T14:00:00.000Z'),
        at('2026-05-01T15:00:00.000Z')
      )
    ).toBe(false);

    // Give the laser category a second unit and the same slot is servable again.
    await seedResource({
      organizationId: venue.organizationId,
      categoryId: lasersId,
      name: 'Laser 2',
      sortOrder: 1,
    });
    const ctxAfter = requireGate(
      await gateFor(venue.organizationId, [serviceId])
    );
    expect(
      hasFreeResourcesFor(
        ctxAfter,
        at('2026-05-01T14:00:00.000Z'),
        at('2026-05-01T15:00:00.000Z')
      )
    ).toBe(true);
  });

  /**
   * Fixed absolute dates, NOT rebased through `at()`: the assertion is about a
   * specific DST transition, and shifting the fixture by an arbitrary delta
   * would slide it off the boundary it exists to straddle.
   *
   * Europe/Dublin leaves IST (UTC+1) for GMT (UTC+0) on Sunday 2030-10-27.
   * Saturday the 26th is therefore UTC+1 and Monday the 28th is UTC+0, so the
   * SAME stored "09:00–17:00" must resolve to two different UTC pairs. A naive
   * implementation that treated the stored minutes as UTC would return
   * 09:00Z–17:00Z on both days and every room in Ireland would run an hour late
   * for half the year.
   *
   * This is a pure read with no future-dated write, so an absolute year cannot
   * time-bomb the way a booking fixture would — the same convention
   * `scheduling.int-spec.ts` uses with its 2030 window.
   */
  it('timezone: a Dublin room resolves 09:00 wall-clock across the October DST boundary', async () => {
    const organizationId = await seedOrganization({
      timezone: 'Europe/Dublin',
    });
    const categoryId = await seedResourceCategory({ organizationId });
    const resourceId = await seedResource({
      organizationId,
      categoryId,
      name: 'Dublin room',
      workingHours: {
        // 6 = Saturday 2030-10-26 (IST, UTC+1)
        6: { from: 9 * 60, to: 17 * 60 },
        // 1 = Monday 2030-10-28 (GMT, UTC+0)
        1: { from: 9 * 60, to: 17 * 60 },
      },
    });

    const [availability] = await resolveResourceAvailability(db, {
      organizationId,
      resourceIds: [resourceId],
      from: new Date('2030-10-24T00:00:00.000Z'),
      to: new Date('2030-10-30T00:00:00.000Z'),
      timeZone: 'Europe/Dublin',
    });

    const working = availability.working.map((range) => [
      range.start.toISOString(),
      range.end.toISOString(),
    ]);

    // Saturday, still on summer time: 09:00 Dublin === 08:00Z.
    expect(working).toContainEqual([
      '2030-10-26T08:00:00.000Z',
      '2030-10-26T16:00:00.000Z',
    ]);
    // Monday, back on GMT: the same 09:00 is now 09:00Z.
    expect(working).toContainEqual([
      '2030-10-28T09:00:00.000Z',
      '2030-10-28T17:00:00.000Z',
    ]);
    // Exactly the two configured days — no phantom third from the day-padding
    // the expansion walks with.
    expect(working).toHaveLength(2);

    // And the difference is real at the point of use: a 08:30Z–09:30Z hold sits
    // inside Saturday's day but straddles Monday's opening.
    const busyBefore = await resolveResourceAvailability(db, {
      organizationId,
      resourceIds: [resourceId],
      from: new Date('2030-10-26T00:00:00.000Z'),
      to: new Date('2030-10-27T00:00:00.000Z'),
      timeZone: 'Europe/Dublin',
    });
    expect(busyBefore[0].working[0].start.toISOString()).toBe(
      '2030-10-26T08:00:00.000Z'
    );
  });

  it('an allocation on a soft-deleted resource cannot make a slot look busy', async () => {
    // Guards the "absent ⇒ not bookable" rule from the other direction: a
    // resource that is dropped from the candidate list must also drop its holds,
    // or a deactivated room would keep blocking the category it left.
    const venue = await seedVenue(1);
    const serviceId = await seedResourceService({
      organizationId: venue.organizationId,
      appointmentDuration: 60,
    });
    const categoryId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Rooms',
    });
    const doomedRoom = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Room being retired',
      sortOrder: 0,
    });
    const liveRoom = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Room staying',
      sortOrder: 1,
    });
    await seedRequirement({
      organizationId: venue.organizationId,
      serviceId,
      categoryId,
    });

    const booked = await bookOnline(venue, {
      serviceId,
      practitionerIndex: 0,
      startDate: at('2026-05-01T14:00:00.000Z'),
      endDate: at('2026-05-01T15:00:00.000Z'),
    });
    expect(booked.success).toBe(true);
    if (!booked.success) throw new Error(booked.error.message);
    expect(booked.data.resources[0].resourceId).toBe(doomedRoom);

    const ctx = requireGate(await gateFor(venue.organizationId, [serviceId]));
    expect(ctx.resourcesByCategory.get(categoryId)).toEqual([
      doomedRoom,
      liveRoom,
    ]);
    // The live room is free, so the slot is still servable.
    expect(
      hasFreeResourcesFor(
        ctx,
        at('2026-05-01T14:00:00.000Z'),
        at('2026-05-01T15:00:00.000Z')
      )
    ).toBe(true);
  });
});

describe('Phase 7 §7c — the gate context itself', () => {
  it('returns null for a cart whose services have no requirements at all', async () => {
    const organizationId = await seedOrganization();
    const serviceId = await seedResourceService({ organizationId });
    // Resources exist in the org — they are simply not required by this service.
    const categoryId = await seedResourceCategory({ organizationId });
    await seedResource({ organizationId, categoryId });

    expect(
      await loadResourceGateContext(db, {
        organizationId,
        serviceIds: [serviceId],
        from: DAY_START,
        to: DAY_END,
        timeZone: 'UTC',
      })
    ).toBeNull();
  });

  it('drops a requirement whose category was soft-deleted: gating degrades to ungated, never to unsellable', async () => {
    const organizationId = await seedOrganization();
    const serviceId = await seedResourceService({ organizationId });
    const categoryId = await seedResourceCategory({
      organizationId,
      name: 'Retired category',
      deletedAt: new Date(),
    });
    await seedResource({ organizationId, categoryId });
    await seedRequirement({ organizationId, serviceId, categoryId });

    // The requirement row still exists, but the category behind it is gone. The
    // service must go back to behaving as if it were never gated — the
    // alternative (honouring a dead category) makes it permanently unbookable.
    expect(
      await loadResourceGateContext(db, {
        organizationId,
        serviceIds: [serviceId],
        from: DAY_START,
        to: DAY_END,
        timeZone: 'UTC',
      })
    ).toBeNull();
  });

  it('drops a requirement whose category has no room AT THIS BRANCH: ungated, never unbookable', async () => {
    // Requirements are ORG-WIDE; resources are BRANCH-filtered. So a branch
    // that sells a service but has no room in its required category used to
    // produce one demand with zero candidates — every slot dropped, the
    // service silently unbookable there, and the symptom an empty calendar
    // that reads as "nothing configured yet".
    //
    // This is the same degradation as the soft-deleted category above, reached
    // a completely different way. It is also why per-branch
    // `service_resource_requirement` rows are not needed: a branch that should
    // not run a service at all says so by not OFFERING it
    // (`organization_service_location`); a branch that sells it without a room
    // is simply ungated.
    const organizationId = await seedOrganization();
    const serviceId = await seedResourceService({ organizationId });
    const categoryId = await seedResourceCategory({
      organizationId,
      name: 'Treatment rooms',
    });
    const dublin = await seedLocation({
      organizationId,
      name: 'Dublin',
      isPrimary: true,
    });
    const cork = await seedLocation({
      organizationId,
      name: 'Cork',
      isPrimary: false,
    });
    // The org HAS a room — it is just in the other branch.
    await seedResource({ organizationId, categoryId, locationId: dublin });
    await seedRequirement({ organizationId, serviceId, categoryId });

    expect(
      await loadResourceGateContext(db, {
        organizationId,
        serviceIds: [serviceId],
        from: DAY_START,
        to: DAY_END,
        timeZone: 'UTC',
        locationId: cork,
      })
    ).toBeNull();

    // …and Dublin, which DOES have the room, is still gated. Degrading
    // everywhere would be the same bug with the opposite sign.
    const dublinGate = await loadResourceGateContext(db, {
      organizationId,
      serviceIds: [serviceId],
      from: DAY_START,
      to: DAY_END,
      timeZone: 'UTC',
      locationId: dublin,
    });
    expect(dublinGate).not.toBeNull();
    expect(requireGate(dublinGate).requirements).toHaveLength(1);
  });

  it('keeps the categories that CAN be satisfied when another is missing HERE', async () => {
    // Two required categories; one has a resource at the other branch only.
    // The satisfiable one must still gate — dropping the whole context would
    // let a booking take a room that is already in use.
    const organizationId = await seedOrganization();
    const serviceId = await seedResourceService({ organizationId });
    const rooms = await seedResourceCategory({ organizationId, name: 'Rooms' });
    const lasers = await seedResourceCategory({
      organizationId,
      name: 'Lasers',
    });
    const dublin = await seedLocation({
      organizationId,
      name: 'Dublin',
      isPrimary: true,
    });
    const cork = await seedLocation({
      organizationId,
      name: 'Cork',
      isPrimary: false,
    });
    await seedResource({
      organizationId,
      categoryId: rooms,
      locationId: dublin,
    });
    // The laser exists — at CORK. So at Dublin this is a branch gap, not an
    // org-wide configuration mistake, and only this category degrades.
    await seedResource({
      organizationId,
      categoryId: lasers,
      locationId: cork,
    });
    await seedRequirement({ organizationId, serviceId, categoryId: rooms });
    await seedRequirement({ organizationId, serviceId, categoryId: lasers });

    const gate = requireGate(
      await loadResourceGateContext(db, {
        organizationId,
        serviceIds: [serviceId],
        from: DAY_START,
        to: DAY_END,
        timeZone: 'UTC',
        locationId: dublin,
      })
    );

    expect(gate.requirements).toHaveLength(1);
    expect(gate.requirements[0].categoryId).toBe(rooms);
  });

  it('KEEPS a requirement whose category is empty ORG-WIDE, so the console still warns', async () => {
    // The distinction the branch rule must not swallow. An empty category
    // everywhere is a configuration mistake the clinic should hear about — a
    // console booking is warned ("no room for this appointment") rather than
    // silently ungated. Dropping this alongside the branch gap is how the
    // degradation first shipped, and `resource-assignment-modes.int-spec.ts`
    // caught it.
    const organizationId = await seedOrganization();
    const serviceId = await seedResourceService({ organizationId });
    const categoryId = await seedResourceCategory({
      organizationId,
      name: 'Rooms',
    });
    const dublin = await seedLocation({
      organizationId,
      name: 'Dublin',
      isPrimary: true,
    });
    // No resource in this category ANYWHERE.
    await seedRequirement({ organizationId, serviceId, categoryId });

    const gate = requireGate(
      await loadResourceGateContext(db, {
        organizationId,
        serviceIds: [serviceId],
        from: DAY_START,
        to: DAY_END,
        timeZone: 'UTC',
        locationId: dublin,
      })
    );

    expect(gate.requirements).toHaveLength(1);
    expect(gate.resourcesByCategory.get(categoryId) ?? []).toEqual([]);
  });

  it('excludeAppointmentIds hides an appointment from its OWN holds (the reschedule case)', async () => {
    const organizationId = await seedOrganization();
    const assignee = await seedUser();
    const leadId = await seedLead({ organizationId });
    const serviceId = await seedResourceService({ organizationId });
    const categoryId = await seedResourceCategory({ organizationId });
    const resourceId = await seedResource({ organizationId, categoryId });
    await seedRequirement({ organizationId, serviceId, categoryId });

    const created = await createAppointment(db, {
      title: 'Holds the only room',
      startDate: at('2026-05-01T14:00:00.000Z'),
      endDate: at('2026-05-01T15:00:00.000Z'),
      leadId,
      assignedToId: assignee.id,
      organizationId,
      serviceId,
      source: 'manual',
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error.message);
    expect(created.data.resources[0].resourceId).toBe(resourceId);

    const window = {
      organizationId,
      serviceIds: [serviceId],
      from: DAY_START,
      to: DAY_END,
      timeZone: 'UTC',
    };
    const slot = {
      start: at('2026-05-01T14:00:00.000Z'),
      end: at('2026-05-01T15:00:00.000Z'),
    };

    // To everyone else the room is busy…
    const forOthers = requireGate(await loadResourceGateContext(db, window));
    expect(hasFreeResourcesFor(forOthers, slot.start, slot.end)).toBe(false);

    // …but not to the appointment that holds it, or a reschedule by ten minutes
    // would conflict with itself.
    const forItself = requireGate(
      await loadResourceGateContext(db, {
        ...window,
        excludeAppointmentIds: [created.data.id],
      })
    );
    expect(hasFreeResourcesFor(forItself, slot.start, slot.end)).toBe(true);
  });

  it('a resource whose own hours close before the cleanup tail cannot take the slot', async () => {
    // Containment, not just overlap: the WHOLE hold (appointment + turnaround)
    // must fit inside one working interval, so a room whose day ends at 17:00
    // cannot take a 16:30 slot that needs 20 minutes of cleanup after 17:00.
    const organizationId = await seedOrganization();
    const serviceId = await seedResourceService({
      organizationId,
      appointmentDuration: 30,
      turnaroundMinutes: 20,
    });
    const categoryId = await seedResourceCategory({ organizationId });
    await seedResource({
      organizationId,
      categoryId,
      name: 'Closes at 17:00',
      // Every day of the week, 09:00–17:00 UTC.
      workingHours: Object.fromEntries(
        [0, 1, 2, 3, 4, 5, 6].map((day) => [day, { from: 540, to: 1020 }])
      ) as never,
    });
    await seedRequirement({ organizationId, serviceId, categoryId });

    const ctx = requireGate(
      await loadResourceGateContext(db, {
        organizationId,
        serviceIds: [serviceId],
        from: DAY_START,
        to: DAY_END,
        timeZone: 'UTC',
      })
    );

    // 16:00–16:30 + 20 min cleanup ends 16:50 — inside the day.
    expect(
      hasFreeResourcesFor(
        ctx,
        at('2026-05-01T16:00:00.000Z'),
        at('2026-05-01T16:30:00.000Z')
      )
    ).toBe(true);

    // 16:45–17:15 + 20 min cleanup ends 17:35 — past closing.
    expect(
      hasFreeResourcesFor(
        ctx,
        at('2026-05-01T16:45:00.000Z'),
        at('2026-05-01T17:15:00.000Z')
      )
    ).toBe(false);
  });
});
