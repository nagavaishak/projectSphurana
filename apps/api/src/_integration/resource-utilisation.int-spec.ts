/**
 * Phase 7 §7h — room utilisation and revenue per open room-hour.
 *
 * This is the number an owner makes staffing and capex decisions on (the
 * industry benchmark is 75–85% treatment-room utilisation), so every figure
 * below is hand-computed from a deliberately small fixture rather than compared
 * against whatever the code happens to return. A report that is merely
 * self-consistent is worthless; a report that is wrong by a factor of three is
 * worse than none at all.
 *
 * Behaviour locked here:
 *  - THE NUMERATOR includes TURNAROUND. The room really is occupied while it is
 *    being cleaned, and excluding the tail would flatter every clinic's figure.
 *    Allocation time is clipped to the reporting window, so a hold that starts
 *    before it or ends after it contributes only its overlap.
 *  - THE DENOMINATOR IS OPENING HOURS, NEVER 24h. `workingHours = null` means
 *    "always available" for BOOKING, and reading that as a 24-hour day here
 *    would divide every clinic's number by roughly three — turning a healthy
 *    80% into a meaningless 27%. The fallback chain is resource hours → the
 *    resource's own location → the location the REPORT is scoped to → the org's
 *    primary location → `organization.businessHours` → 0.
 *  - A LOCATION-FILTERED report measures a location-LESS resource (a
 *    trolley-mounted device, available everywhere) against the FILTERED
 *    location, not the primary. "How utilised is this at Branch B" and "how
 *    utilised is this overall" are different questions, and answering the first
 *    with the primary's hours silently understates the branch actually asked
 *    about.
 *  - REVENUE SPLITS EVENLY and RECONCILES EXACTLY. An appointment holding a
 *    room and a laser contributes half to each, so category subtotals sum back
 *    to the appointment total instead of double-counting it. The odd cent goes
 *    to the lowest `resourceId`, so the split is reproducible and adds up to the
 *    penny — asserted on an ODD total, where a naive `total / n` drifts.
 *  - ZERO BOOKINGS is 0, never `NaN` (which serialises to JSON `null` and
 *    renders as a blank cell that reads as a loading state) and never
 *    `Infinity`.
 *  - CANCELLED AND DELETED APPOINTMENTS CONTRIBUTE NOTHING, even when their
 *    allocation has LEAKED. Allocations are supposed to be released on those
 *    transitions, but this report joins back to `appointment` and filters on
 *    status anyway: a leak must not silently inflate a customer-facing revenue
 *    figure. The leaks below are seeded on purpose — that is the only way to
 *    exercise the defence.
 *  - Utilisation is a 0..1 RATIO and is NOT clamped: a capacity > 1 resource
 *    legitimately exceeds 1.0, and hiding that would hide genuine
 *    over-allocation.
 */
import { db } from '@borradh-workspace/database';
import { createAppointment } from '@borradh-workspace/features/appointments';
import { getResourceUtilisation } from '@borradh-workspace/features/resources';
import type { ResourceUtilisationRow } from '@borradh-workspace/features/resources';
import { seedLead, seedOrganization, seedUser } from './harness.js';
import {
  seedAllocation,
  seedRequirement,
  seedResource,
  seedResourceCategory,
  seedResourceLocation,
  seedResourceService,
} from './seeds/resources.js';

/**
 * A fixed week, NOT rebased onto a moving anchor.
 *
 * Utilisation is arithmetic over calendar days: the denominator counts weekday
 * opening hours, so the fixture has to land on known weekdays for the expected
 * figure to be hand-computable at all. 2030-06-03 is a Monday and
 * 2030-06-10 the Monday after, giving exactly five weekdays and two weekend
 * days in the window. The same convention `scheduling.int-spec.ts` uses — and
 * safe here in a way a booking fixture is not, because nothing in this file
 * goes through `create-appointment`'s past-booking backstop as a PAST date.
 */
const WEEK = {
  from: new Date('2030-06-03T00:00:00.000Z'), // Monday
  to: new Date('2030-06-10T00:00:00.000Z'), // the following Monday
};

/** 09:00–17:00 Monday to Friday. 5 × 480 = 2400 open minutes in the week. */
const WEEKDAYS_NINE_TO_FIVE = {
  1: { from: 9 * 60, to: 17 * 60 },
  2: { from: 9 * 60, to: 17 * 60 },
  3: { from: 9 * 60, to: 17 * 60 },
  4: { from: 9 * 60, to: 17 * 60 },
  5: { from: 9 * 60, to: 17 * 60 },
} as never;
const WEEKDAY_OPEN_MINUTES = 5 * 8 * 60; // 2400

/** 08:00–20:00 every day. 7 × 720 = 5040 open minutes in the week. */
const ALL_WEEK_EIGHT_TO_EIGHT = Object.fromEntries(
  [0, 1, 2, 3, 4, 5, 6].map((day) => [day, { from: 8 * 60, to: 20 * 60 }])
) as never;
const ALL_WEEK_OPEN_MINUTES = 7 * 12 * 60; // 5040

interface Venue {
  organizationId: string;
  assigneeId: string;
  leadId: string;
}

async function seedVenue(): Promise<Venue> {
  const organizationId = await seedOrganization();
  const assignee = await seedUser();
  return {
    organizationId,
    assigneeId: assignee.id,
    leadId: await seedLead({ organizationId }),
  };
}

/**
 * Book a gated appointment WITH cart line items.
 *
 * The cart is not decoration: revenue attribution reads
 * `appointment_service.price_cents`, and `createAppointment` only writes line
 * items when a `services` array is supplied. A booking made with just a bare
 * `serviceId` contributes zero revenue, which would make every revenue
 * assertion below pass for the wrong reason.
 */
const book = (
  venue: Venue,
  input: {
    title: string;
    serviceId: string;
    startDate: Date;
    endDate: Date;
    priceCents: number;
    status?: 'booked' | 'cancelled';
    resourceIds?: string[];
    assignedToId?: string;
  }
) =>
  createAppointment(db, {
    title: input.title,
    startDate: input.startDate,
    endDate: input.endDate,
    leadId: venue.leadId,
    assignedToId: input.assignedToId ?? venue.assigneeId,
    organizationId: venue.organizationId,
    serviceId: input.serviceId,
    status: input.status,
    resourceIds: input.resourceIds,
    services: [
      {
        serviceId: input.serviceId,
        name: input.title,
        durationMinutes: Math.round(
          (input.endDate.getTime() - input.startDate.getTime()) / 60_000
        ),
        priceCents: input.priceCents,
      },
    ],
  });

const report = async (organizationId: string, locationId?: string) => {
  const result = await getResourceUtilisation(db, {
    organizationId,
    from: WEEK.from,
    to: WEEK.to,
    locationId,
  });
  if (!result.success) throw new Error(result.error.message);
  return result.data;
};

const rowFor = (
  rows: ResourceUtilisationRow[],
  resourceId: string
): ResourceUtilisationRow => {
  const row = rows.find((candidate) => candidate.resourceId === resourceId);
  if (!row)
    throw new Error(`resource ${resourceId} is missing from the report`);
  return row;
};

describe('Phase 7 §7h — resource utilisation', () => {
  it('a hand-computed week matches exactly', async () => {
    const venue = await seedVenue();
    const serviceId = await seedResourceService({
      organizationId: venue.organizationId,
      name: 'Facial',
      appointmentDuration: 60,
      priceCents: 5000,
    });
    const categoryId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Rooms',
    });
    const roomId = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Room 1',
      workingHours: WEEKDAYS_NINE_TO_FIVE,
    });
    await seedRequirement({
      organizationId: venue.organizationId,
      serviceId,
      categoryId,
    });

    // Two one-hour bookings at €50 each, on the Tuesday and the Wednesday.
    for (const day of ['2030-06-04', '2030-06-05']) {
      const created = await book(venue, {
        title: `Facial ${day}`,
        serviceId,
        startDate: new Date(`${day}T10:00:00.000Z`),
        endDate: new Date(`${day}T11:00:00.000Z`),
        priceCents: 5000,
      });
      expect(created.success).toBe(true);
      if (!created.success) throw new Error(created.error.message);
      expect(created.data.resources).toHaveLength(1);
    }

    const { rows } = await report(venue.organizationId);
    expect(rows).toHaveLength(1);
    const row = rowFor(rows, roomId);

    // Denominator: 5 weekdays × 8 hours.
    expect(row.openMinutes).toBe(WEEKDAY_OPEN_MINUTES); // 2400
    // Numerator: 2 × 60 minutes.
    expect(row.bookedMinutes).toBe(120);
    // 120 / 2400.
    expect(row.utilisation).toBe(0.05);
    // Both appointments hold only this room, so it takes their whole value.
    expect(row.revenueCents).toBe(10_000);
    // 10 000 cents over 40 open hours.
    expect(row.revenuePerOpenHourCents).toBe(250);
    expect(row.categoryId).toBe(categoryId);
    expect(row.categoryName).toBe('Rooms');
    expect(row.resourceName).toBe('Room 1');
  });

  it('turnaround minutes count as booked — the room is occupied while it is cleaned', async () => {
    const venue = await seedVenue();
    const serviceId = await seedResourceService({
      organizationId: venue.organizationId,
      appointmentDuration: 60,
      priceCents: 5000,
      turnaroundMinutes: 30,
    });
    const categoryId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Rooms',
    });
    const roomId = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Room 1',
      workingHours: WEEKDAYS_NINE_TO_FIVE,
    });
    await seedRequirement({
      organizationId: venue.organizationId,
      serviceId,
      categoryId,
    });

    const created = await book(venue, {
      title: 'One hour plus cleanup',
      serviceId,
      startDate: new Date('2030-06-04T10:00:00.000Z'),
      endDate: new Date('2030-06-04T11:00:00.000Z'),
      priceCents: 5000,
    });
    expect(created.success).toBe(true);

    const row = rowFor((await report(venue.organizationId)).rows, roomId);
    // 60 minutes of treatment + 30 of turnaround.
    expect(row.bookedMinutes).toBe(90);
    expect(row.utilisation).toBe(0.0375); // 90 / 2400
  });

  it('an allocation straddling the window edge contributes only its overlap', async () => {
    const venue = await seedVenue();
    const categoryId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Rooms',
    });
    const roomId = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Room 1',
      // Open around the clock on the Monday, so the clip — not the opening
      // hours — is what bounds the count.
      workingHours: ALL_WEEK_EIGHT_TO_EIGHT,
    });
    const assignee = await seedUser();
    const created = await createAppointment(db, {
      title: 'Starts before the window',
      startDate: new Date('2030-06-02T22:00:00.000Z'),
      endDate: new Date('2030-06-03T02:00:00.000Z'),
      leadId: venue.leadId,
      assignedToId: assignee.id,
      organizationId: venue.organizationId,
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error.message);

    await seedAllocation({
      organizationId: venue.organizationId,
      appointmentId: created.data.id,
      resourceId: roomId,
      startDate: new Date('2030-06-02T22:00:00.000Z'),
      endDate: new Date('2030-06-03T02:00:00.000Z'),
    });

    const row = rowFor((await report(venue.organizationId)).rows, roomId);
    // Four hours held, but only the two inside the window are counted.
    expect(row.bookedMinutes).toBe(120);
  });

  it('workingHours = null falls back to the LOCATION opening hours, not a 24h day', async () => {
    const venue = await seedVenue();
    const locationId = await seedResourceLocation({
      organizationId: venue.organizationId,
      name: 'Main clinic',
      openingHours: WEEKDAYS_NINE_TO_FIVE,
      isPrimary: true,
    });
    const categoryId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Rooms',
    });
    const roomId = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Room 1',
      locationId,
      workingHours: null, // "always available" — for BOOKING, not for reporting
    });

    const row = rowFor((await report(venue.organizationId)).rows, roomId);
    expect(row.openMinutes).toBe(WEEKDAY_OPEN_MINUTES); // 2400
    // The whole point: a 24-hour denominator would be 10 080 and would divide
    // every clinic's utilisation by more than four.
    expect(row.openMinutes).not.toBe(7 * 24 * 60);
  });

  it('a location-filtered report measures a location-LESS resource against the FILTERED location', async () => {
    const venue = await seedVenue();
    const primary = await seedResourceLocation({
      organizationId: venue.organizationId,
      name: 'Branch A (primary, 9–5 weekdays)',
      openingHours: WEEKDAYS_NINE_TO_FIVE,
      isPrimary: true,
    });
    const branchB = await seedResourceLocation({
      organizationId: venue.organizationId,
      name: 'Branch B (8–8 every day)',
      openingHours: ALL_WEEK_EIGHT_TO_EIGHT,
    });
    const categoryId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Devices',
      kind: 'equipment',
    });
    // A trolley-mounted device: no location of its own, available everywhere,
    // so it appears in every location's report.
    const rovingId = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Roving laser',
      locationId: null,
      workingHours: null,
    });

    // Asked about Branch B, the answer must use Branch B's hours…
    const atBranchB = rowFor(
      (await report(venue.organizationId, branchB)).rows,
      rovingId
    );
    expect(atBranchB.openMinutes).toBe(ALL_WEEK_OPEN_MINUTES); // 5040
    // …not the primary's, which would understate Branch B by more than half.
    expect(atBranchB.openMinutes).not.toBe(WEEKDAY_OPEN_MINUTES);

    // Unfiltered, the primary location is the right fallback.
    const unfiltered = rowFor(
      (await report(venue.organizationId)).rows,
      rovingId
    );
    expect(unfiltered.openMinutes).toBe(WEEKDAY_OPEN_MINUTES); // 2400

    // A resource pinned to Branch A keeps ITS OWN location's hours even in a
    // Branch-B-scoped report — but it is filtered out of that report entirely.
    const pinnedId = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Bolted-down laser',
      locationId: primary,
      workingHours: null,
    });
    const branchBRows = (await report(venue.organizationId, branchB)).rows;
    expect(branchBRows.map((row) => row.resourceId)).not.toContain(pinnedId);
    const primaryRows = (await report(venue.organizationId, primary)).rows;
    expect(rowFor(primaryRows, pinnedId).openMinutes).toBe(
      WEEKDAY_OPEN_MINUTES
    );
  });

  it('revenue splits evenly across the resources an appointment holds and reconciles to the penny', async () => {
    const venue = await seedVenue();
    // An ODD total, so "half each" cannot come out exactly and the remainder
    // rule is actually exercised. A naive `total / n` would drift by a cent.
    const ODD_TOTAL_CENTS = 10_001;

    const serviceId = await seedResourceService({
      organizationId: venue.organizationId,
      name: 'IPL facial',
      appointmentDuration: 60,
      priceCents: ODD_TOTAL_CENTS,
    });
    const roomsId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Rooms',
      sortOrder: 0,
    });
    const lasersId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Lasers',
      kind: 'equipment',
      sortOrder: 1,
    });
    const roomId = await seedResource({
      organizationId: venue.organizationId,
      categoryId: roomsId,
      name: 'Room 1',
      workingHours: WEEKDAYS_NINE_TO_FIVE,
    });
    const laserId = await seedResource({
      organizationId: venue.organizationId,
      categoryId: lasersId,
      name: 'Laser 1',
      workingHours: WEEKDAYS_NINE_TO_FIVE,
    });
    for (const categoryId of [roomsId, lasersId]) {
      await seedRequirement({
        organizationId: venue.organizationId,
        serviceId,
        categoryId,
      });
    }

    const created = await book(venue, {
      title: 'Holds a room and a laser',
      serviceId,
      startDate: new Date('2030-06-04T10:00:00.000Z'),
      endDate: new Date('2030-06-04T11:00:00.000Z'),
      priceCents: ODD_TOTAL_CENTS,
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error.message);
    expect(created.data.resources).toHaveLength(2);

    const { rows } = await report(venue.organizationId);
    const room = rowFor(rows, roomId);
    const laser = rowFor(rows, laserId);

    // RECONCILIATION: the subtotals sum back to the appointment total exactly —
    // no double-counting (which would give 20 002) and no drift.
    expect(room.revenueCents + laser.revenueCents).toBe(ODD_TOTAL_CENTS);

    // The odd cent goes to the LOWEST resource id, so the split is reproducible
    // rather than depending on row order.
    const [lower, higher] = [room, laser].sort((a, b) =>
      a.resourceId.localeCompare(b.resourceId)
    );
    expect(lower.revenueCents).toBe(5001);
    expect(higher.revenueCents).toBe(5000);

    // Both were genuinely occupied for the hour — the split is of revenue, not
    // of time.
    expect(room.bookedMinutes).toBe(60);
    expect(laser.bookedMinutes).toBe(60);
  });

  it('the last fallback in the denominator chain is organization.businessHours', async () => {
    // A resource with no hours of its own and no location still gets an HONEST
    // denominator: the business's own opening hours. `organization.business_hours`
    // is NOT NULL with a default of 09:00–18:00 Monday to Friday, which is
    // 5 x 540 = 2700 minutes across this window.
    const venue = await seedVenue();
    const categoryId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Rooms',
    });
    const roomId = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Room 1',
      locationId: null,
      workingHours: null,
    });

    const row = rowFor((await report(venue.organizationId)).rows, roomId);
    expect(row.openMinutes).toBe(5 * 9 * 60); // 2700
    expect(row.openMinutes).not.toBe(7 * 24 * 60);
  });

  it('a resource with zero bookings reports 0, never NaN or Infinity', async () => {
    // The org is CLOSED all week (`from === to` is the stored convention for a
    // closed day), so the denominator genuinely resolves to zero for a resource
    // that inherits it — the one state where a careless divide yields NaN,
    // which JSON-serialises to null and renders as a blank cell that reads like
    // a loading state.
    const organizationId = await seedOrganization({
      businessHours: Object.fromEntries(
        [0, 1, 2, 3, 4, 5, 6].map((day) => [day, { from: 0, to: 0 }])
      ),
    });
    const categoryId = await seedResourceCategory({
      organizationId,
      name: 'Rooms',
    });
    const withHours = await seedResource({
      organizationId,
      categoryId,
      name: 'Idle room with hours',
      workingHours: WEEKDAYS_NINE_TO_FIVE,
    });
    const withoutHours = await seedResource({
      organizationId,
      categoryId,
      name: 'Idle room inheriting a closed week',
      workingHours: null,
    });

    const { rows } = await report(organizationId);

    const idle = rowFor(rows, withHours);
    expect(idle.openMinutes).toBe(WEEKDAY_OPEN_MINUTES);
    expect(idle.bookedMinutes).toBe(0);
    expect(idle.utilisation).toBe(0);
    expect(idle.revenueCents).toBe(0);
    expect(idle.revenuePerOpenHourCents).toBe(0);

    const undenominated = rowFor(rows, withoutHours);
    expect(undenominated.openMinutes).toBe(0);
    expect(undenominated.utilisation).toBe(0);
    expect(Number.isNaN(undenominated.utilisation)).toBe(false);
    expect(Number.isFinite(undenominated.utilisation)).toBe(true);
    expect(undenominated.revenuePerOpenHourCents).toBe(0);
    expect(Number.isFinite(undenominated.revenuePerOpenHourCents)).toBe(true);
  });

  it('a LEAKED allocation on a cancelled appointment contributes nothing', async () => {
    // Allocations are supposed to be released on cancel, so this state should
    // never arise — which is exactly why the report's status filter is never
    // exercised by a normal flow. Seed the leak deliberately: a leak must not
    // silently inflate a customer-facing revenue figure.
    const venue = await seedVenue();
    const serviceId = await seedResourceService({
      organizationId: venue.organizationId,
      appointmentDuration: 60,
      priceCents: 5000,
    });
    const categoryId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Rooms',
    });
    const roomId = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Room 1',
      workingHours: WEEKDAYS_NINE_TO_FIVE,
    });

    // A cancelled appointment holds nothing at birth, so nothing is released
    // out from under the seeded row below.
    const cancelled = await book(venue, {
      title: 'Cancelled but still holding',
      serviceId,
      startDate: new Date('2030-06-04T10:00:00.000Z'),
      endDate: new Date('2030-06-04T11:00:00.000Z'),
      priceCents: 5000,
      status: 'cancelled',
    });
    expect(cancelled.success).toBe(true);
    if (!cancelled.success) throw new Error(cancelled.error.message);
    await seedAllocation({
      organizationId: venue.organizationId,
      appointmentId: cancelled.data.id,
      resourceId: roomId,
      startDate: new Date('2030-06-04T10:00:00.000Z'),
      endDate: new Date('2030-06-04T11:00:00.000Z'),
    });

    // …plus one real, active booking, so a bug that dropped EVERYTHING could
    // not pass this test.
    const live = await book(venue, {
      title: 'Genuine booking',
      serviceId,
      startDate: new Date('2030-06-05T10:00:00.000Z'),
      endDate: new Date('2030-06-05T11:00:00.000Z'),
      priceCents: 5000,
    });
    expect(live.success).toBe(true);
    if (!live.success) throw new Error(live.error.message);
    await seedAllocation({
      organizationId: venue.organizationId,
      appointmentId: live.data.id,
      resourceId: roomId,
      startDate: new Date('2030-06-05T10:00:00.000Z'),
      endDate: new Date('2030-06-05T11:00:00.000Z'),
    });

    const row = rowFor((await report(venue.organizationId)).rows, roomId);
    expect(row.bookedMinutes).toBe(60);
    expect(row.revenueCents).toBe(5000);
  });

  it('a LEAKED allocation on a soft-deleted appointment contributes nothing', async () => {
    const venue = await seedVenue();
    const serviceId = await seedResourceService({
      organizationId: venue.organizationId,
      appointmentDuration: 60,
      priceCents: 9000,
    });
    const categoryId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Rooms',
    });
    const roomId = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Room 1',
      workingHours: WEEKDAYS_NINE_TO_FIVE,
    });

    const created = await book(venue, {
      title: 'Deleted but still holding',
      serviceId,
      startDate: new Date('2030-06-04T10:00:00.000Z'),
      endDate: new Date('2030-06-04T11:00:00.000Z'),
      priceCents: 9000,
      status: 'cancelled',
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error.message);
    await seedAllocation({
      organizationId: venue.organizationId,
      appointmentId: created.data.id,
      resourceId: roomId,
      startDate: new Date('2030-06-04T10:00:00.000Z'),
      endDate: new Date('2030-06-04T11:00:00.000Z'),
    });

    const row = rowFor((await report(venue.organizationId)).rows, roomId);
    expect(row.bookedMinutes).toBe(0);
    expect(row.revenueCents).toBe(0);
    expect(row.utilisation).toBe(0);
  });

  it('utilisation is NOT clamped: a capacity > 1 resource legitimately exceeds 1.0', async () => {
    // Hiding over-allocation would hide the very thing an owner buys a second
    // room to fix.
    const venue = await seedVenue();
    const otherAssignee = await seedUser();
    const serviceId = await seedResourceService({
      organizationId: venue.organizationId,
      appointmentDuration: 60,
      priceCents: 4000,
    });
    const categoryId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Double room',
    });
    const roomId = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Room 1 (2 beds)',
      capacity: 2,
      // Open for exactly one hour in the whole week, on the Tuesday.
      workingHours: { 2: { from: 10 * 60, to: 11 * 60 } } as never,
    });
    await seedRequirement({
      organizationId: venue.organizationId,
      serviceId,
      categoryId,
    });

    for (const [index, assignedToId] of [
      venue.assigneeId,
      otherAssignee.id,
    ].entries()) {
      const created = await book(venue, {
        title: `Bed ${index + 1}`,
        serviceId,
        startDate: new Date('2030-06-04T10:00:00.000Z'),
        endDate: new Date('2030-06-04T11:00:00.000Z'),
        priceCents: 4000,
        assignedToId,
      });
      expect(created.success).toBe(true);
    }

    const row = rowFor((await report(venue.organizationId)).rows, roomId);
    expect(row.openMinutes).toBe(60);
    expect(row.bookedMinutes).toBe(120);
    expect(row.utilisation).toBe(2);
    // Each appointment holds only this room, so both totals land here.
    expect(row.revenueCents).toBe(8000);
  });

  it('inactive and soft-deleted resources are absent from the report entirely', async () => {
    const venue = await seedVenue();
    const categoryId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Rooms',
    });
    const live = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Live',
      workingHours: WEEKDAYS_NINE_TO_FIVE,
    });
    const inactive = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Deactivated',
      isActive: false,
      workingHours: WEEKDAYS_NINE_TO_FIVE,
    });
    const removed = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Deleted',
      deletedAt: new Date(),
      workingHours: WEEKDAYS_NINE_TO_FIVE,
    });

    const { rows } = await report(venue.organizationId);
    expect(rows.map((row) => row.resourceId)).toEqual([live]);
    expect(rows.map((row) => row.resourceId)).not.toContain(inactive);
    expect(rows.map((row) => row.resourceId)).not.toContain(removed);
  });

  it('the report is org-scoped and refuses a backwards window', async () => {
    const venue = await seedVenue();
    const other = await seedVenue();
    const categoryId = await seedResourceCategory({
      organizationId: other.organizationId,
      name: 'Their rooms',
    });
    await seedResource({
      organizationId: other.organizationId,
      categoryId,
      name: 'Their room',
      workingHours: WEEKDAYS_NINE_TO_FIVE,
    });

    expect((await report(venue.organizationId)).rows).toEqual([]);

    const backwards = await getResourceUtilisation(db, {
      organizationId: venue.organizationId,
      from: WEEK.to,
      to: WEEK.from,
    });
    expect(backwards.success).toBe(false);
    if (backwards.success) throw new Error('expected a validation failure');
    expect(backwards.error.code).toBe('VALIDATION_ERROR');
  });

  it('rows come back in render order: category order, then resource order, then name', async () => {
    const venue = await seedVenue();
    const lateCategory = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Zzz devices',
      sortOrder: 5,
    });
    const earlyCategory = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Aaa rooms',
      sortOrder: 0,
    });
    const device = await seedResource({
      organizationId: venue.organizationId,
      categoryId: lateCategory,
      name: 'Device',
      sortOrder: 0,
    });
    const roomB = await seedResource({
      organizationId: venue.organizationId,
      categoryId: earlyCategory,
      name: 'Room B',
      sortOrder: 1,
    });
    const roomA = await seedResource({
      organizationId: venue.organizationId,
      categoryId: earlyCategory,
      name: 'Room A',
      sortOrder: 0,
    });

    const { rows } = await report(venue.organizationId);
    expect(rows.map((row) => row.resourceId)).toEqual([roomA, roomB, device]);
  });
});
