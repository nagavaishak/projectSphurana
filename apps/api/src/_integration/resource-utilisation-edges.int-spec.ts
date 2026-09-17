/**
 * Phase 7 §7h (edges) — the arithmetic at the boundaries of the utilisation
 * report.
 *
 * `resource-utilisation.int-spec.ts` locks the headline behaviours on a
 * hand-computed week. This file takes the same report to the places where a
 * plausible implementation quietly stops being correct: the clip at the window
 * edge, a divide by a zero denominator that HAS revenue behind it, a split that
 * does not divide evenly, a booking with no price at all, and the ordering
 * tie-break nothing else reaches. Every figure below is hand-computed from a
 * deliberately small fixture — a report that is merely self-consistent is
 * worthless, and this is the number an owner makes capex decisions on.
 *
 * Behaviour locked here:
 *  - THE CLIP IS EXACT AT BOTH EDGES. A hold that starts before the window,
 *    one that ends after it, and one that swallows the whole week each
 *    contribute their IN-WINDOW minutes and nothing more. Counting the whole
 *    hold would let last month's late finish inflate this month's report.
 *  - CAPACITY > 1 IS NOT CLAMPED. Three concurrent holds on a capacity-3 room
 *    are three rooms' worth of work in one space; 150% is the true answer and
 *    clamping it to 100% hides the case a second room is bought to fix.
 *  - A ZERO DENOMINATOR WITH REVENUE BEHIND IT IS STILL 0. This is the one that
 *    yields `Infinity`, not `NaN`: a room that earned €75 across a week it was
 *    never open divides a real numerator by zero. `Infinity` JSON-serialises to
 *    `null` and renders as a blank cell — the same as "no data", so nobody ever
 *    reports it.
 *  - A THREE-WAY SPLIT RECONCILES TO THE PENNY. €100.00 across three resources
 *    does not divide; the parts must still sum to exactly the appointment
 *    total, with the remainder landing on the lowest `resourceId` so the answer
 *    is reproducible rather than row-order dependent.
 *  - AN UNPRICED APPOINTMENT OCCUPIES THE ROOM. Zero revenue, full booked
 *    minutes. Dropping it from the numerator would make a clinic that books
 *    consultations look half as busy as it is.
 *  - CANCELLED, NO-SHOW AND SOFT-DELETED CONTRIBUTE NOTHING, even when their
 *    allocation has LEAKED. Allocations are supposed to be released on those
 *    transitions, so the report's status filter is never exercised by a normal
 *    flow; the leaks below are seeded deliberately, because that is the only
 *    way to exercise a defence.
 *  - ORDERING FALLS THROUGH TO NAME. Category order, then resource order, then
 *    name — asserted on resources whose sort orders TIE, which is the only
 *    arrangement that reaches the third comparator at all.
 *  - A LOCATION-FILTERED REPORT CONTAINS EXACTLY the resources at that location
 *    plus the location-less ones, asserted as the whole row set rather than as
 *    one row's denominator.
 */
import { randomUUID } from 'node:crypto';
import {
  appointment,
  appointmentService,
  db,
} from '@borradh-workspace/database';
import { getResourceUtilisation } from '@borradh-workspace/features/resources';
import type { ResourceUtilisationRow } from '@borradh-workspace/features/resources';
import { eq } from 'drizzle-orm';
import {
  seedAppointment,
  seedLead,
  seedOrganization,
  seedUser,
} from './harness.js';
import {
  seedAllocation,
  seedResource,
  seedResourceCategory,
  seedResourceLocation,
} from './seeds/resources.js';

/**
 * A whole week, anchored on a MONDAY at least a fortnight out.
 *
 * Utilisation is arithmetic over calendar days — the denominator counts
 * weekday opening hours — so the fixture has to land on KNOWN weekdays for the
 * expected figure to be hand-computable at all. Anchoring on the next Monday
 * past a two-week grace gives that without pinning an absolute year that would
 * rot, and every org below runs in UTC, so no DST transition can move a day
 * boundary underneath the arithmetic. (The DST cases live in
 * `resource-timezone.int-spec.ts`, where they are the point rather than a
 * hazard.)
 */
const WEEK_START_MS = (() => {
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  base.setUTCDate(base.getUTCDate() + 14);
  while (base.getUTCDay() !== 1) base.setUTCDate(base.getUTCDate() + 1);
  return base.getTime();
})();

const DAY_MS = 86_400_000;

/** An instant `dayOffset` days into the fixture week, at a UTC wall time. */
const onDay = (dayOffset: number, hour = 0, minute = 0) =>
  new Date(
    WEEK_START_MS + dayOffset * DAY_MS + hour * 3_600_000 + minute * 60_000
  );

/** Day offsets from the anchor Monday, for readable fixtures. */
const MON = 0;
const TUE = 1;
const SUN = 6;

const WEEK = { from: onDay(0), to: onDay(7) };

/** 08:00–20:00 every day: 7 × 720 = 5040 open minutes across the week. */
const ALL_WEEK_EIGHT_TO_EIGHT = Object.fromEntries(
  [0, 1, 2, 3, 4, 5, 6].map((day) => [day, { from: 8 * 60, to: 20 * 60 }])
) as never;
const ALL_WEEK_OPEN_MINUTES = 7 * 12 * 60; // 5040

/** Tuesday 10:00–12:00 and nothing else: 120 open minutes across the week. */
const TUESDAY_TWO_HOURS = { 2: { from: 10 * 60, to: 12 * 60 } } as never;

/** A resource that is NEVER open — an hours record with no days in it at all. */
const NEVER_OPEN = {} as never;

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
 * An appointment holding one or more resources, with an optional price.
 *
 * Seeded DIRECTLY rather than through `createAppointment` on purpose: these
 * tests need states the booking service will not produce — a hold on a room
 * that is never open, three resources held by one appointment, a leaked
 * allocation behind a cancelled appointment. The service layer must not sit
 * between the test and the arithmetic under test.
 *
 * `priceCents === null` writes NO line item at all, which is exactly what an
 * appointment booked without a cart looks like.
 */
async function holdRooms(
  venue: Venue,
  input: {
    resourceIds: string[];
    start: Date;
    end: Date;
    priceCents?: number | null;
    allowOverlap?: boolean;
    title?: string;
  }
): Promise<string> {
  const appointmentId = await seedAppointment({
    organizationId: venue.organizationId,
    assignedToId: venue.assigneeId,
    leadId: venue.leadId,
    title: input.title ?? 'Booking',
    startDate: input.start,
    endDate: input.end,
  });

  if (input.priceCents != null) {
    await db.insert(appointmentService).values({
      id: `asvc_${randomUUID()}`,
      appointmentId,
      name: input.title ?? 'Booking',
      durationMinutes: Math.round(
        (input.end.getTime() - input.start.getTime()) / 60_000
      ),
      priceCents: input.priceCents,
    });
  }

  for (const resourceId of input.resourceIds) {
    await seedAllocation({
      organizationId: venue.organizationId,
      appointmentId,
      resourceId,
      startDate: input.start,
      endDate: input.end,
      allowOverlap: input.allowOverlap,
    });
  }

  return appointmentId;
}

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

describe('Phase 7 §7h — resource utilisation edges', () => {
  it('a hold straddling either window edge contributes only its IN-WINDOW minutes', async () => {
    const venue = await seedVenue();
    const categoryId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Rooms',
    });
    const mk = (name: string, sortOrder: number) =>
      seedResource({
        organizationId: venue.organizationId,
        categoryId,
        name,
        sortOrder,
        workingHours: ALL_WEEK_EIGHT_TO_EIGHT,
      });

    const leading = await mk('Started last week', 0);
    const trailing = await mk('Runs into next week', 1);
    const spanning = await mk('Held all fortnight', 2);

    // Sunday 22:00 (the day BEFORE the window) → Monday 02:00. Two hours inside.
    await holdRooms(venue, {
      resourceIds: [leading],
      start: onDay(MON - 1, 22),
      end: onDay(MON, 2),
    });
    // Sunday 23:00 → the following Monday 01:00. One hour inside.
    await holdRooms(venue, {
      resourceIds: [trailing],
      start: onDay(SUN, 23),
      end: onDay(SUN + 1, 1),
    });
    // Three days before the window to three days after it: the WHOLE week.
    await holdRooms(venue, {
      resourceIds: [spanning],
      start: onDay(-3),
      end: onDay(10),
    });

    const { rows } = await report(venue.organizationId);

    // 22:00–00:00 is outside; only 00:00–02:00 counts.
    expect(rowFor(rows, leading).bookedMinutes).toBe(120);
    // 23:00–00:00 counts; 00:00–01:00 the following Monday does not.
    expect(rowFor(rows, trailing).bookedMinutes).toBe(60);
    // Exactly seven days, not the thirteen the hold actually spans.
    expect(rowFor(rows, spanning).bookedMinutes).toBe(7 * 24 * 60); // 10 080

    // And the clip feeds the ratio, not just the raw minutes.
    expect(rowFor(rows, leading).openMinutes).toBe(ALL_WEEK_OPEN_MINUTES);
    expect(rowFor(rows, leading).utilisation).toBe(0.0238); // 120 / 5040
  });

  it('capacity 3: three concurrent holds all count, and 150% is not clamped', async () => {
    // Clamping would hide the exact condition an owner buys a fourth chair to
    // fix. The room is open for two hours in the entire week, and three
    // customers are in it for one of them.
    const venue = await seedVenue();
    const categoryId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Nail bar',
      kind: 'equipment',
    });
    const barId = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Nail bar (3 stations)',
      capacity: 3,
      workingHours: TUESDAY_TWO_HOURS,
    });

    for (const station of [1, 2, 3]) {
      await holdRooms(venue, {
        resourceIds: [barId],
        start: onDay(TUE, 10),
        end: onDay(TUE, 11),
        title: `Station ${station}`,
        // Capacity > 1 allocations opt out of `resource_no_overlap`; the
        // service layer counts concurrency instead. Without this the DB
        // refuses the second insert and the test would never reach the report.
        allowOverlap: true,
      });
    }

    const row = rowFor((await report(venue.organizationId)).rows, barId);
    expect(row.openMinutes).toBe(120);
    expect(row.bookedMinutes).toBe(180);
    expect(row.utilisation).toBe(1.5);
    // Said plainly: the number is allowed above 1.
    expect(row.utilisation).toBeGreaterThan(1);
  });

  it('a resource open on ZERO days reports 0 — even when it earned real revenue', async () => {
    // The `Infinity` case, not the `NaN` one. A genuine numerator over a zero
    // denominator is what a misconfigured room looks like the week after
    // somebody clears its hours by hand, and `Infinity` serialises to JSON
    // `null` — indistinguishable from "no data", so the misconfiguration is
    // never reported.
    const venue = await seedVenue();
    const categoryId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Rooms',
    });
    const roomId = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Room with no hours at all',
      workingHours: NEVER_OPEN,
    });

    await holdRooms(venue, {
      resourceIds: [roomId],
      start: onDay(TUE, 10),
      end: onDay(TUE, 11),
      priceCents: 7500,
    });

    const row = rowFor((await report(venue.organizationId)).rows, roomId);
    expect(row.openMinutes).toBe(0);
    // The work and the money are both real…
    expect(row.bookedMinutes).toBe(60);
    expect(row.revenueCents).toBe(7500);
    // …and both derived figures are still finite zeroes.
    expect(row.utilisation).toBe(0);
    expect(row.revenuePerOpenHourCents).toBe(0);
    expect(Number.isFinite(row.utilisation)).toBe(true);
    expect(Number.isFinite(row.revenuePerOpenHourCents)).toBe(true);
    expect(Number.isNaN(row.revenuePerOpenHourCents)).toBe(false);
  });

  it('revenue splits across THREE resources and the parts sum to the total exactly', async () => {
    // €100.00 does not divide by three. The parts must still reconcile to the
    // penny, and the odd cent must land somewhere reproducible — otherwise two
    // runs of the same report disagree and nobody trusts either.
    const venue = await seedVenue();
    const TOTAL_CENTS = 10_000;

    const categoryId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Everything',
    });
    const ids: string[] = [];
    for (const name of ['Room 1', 'Laser 1', 'Trolley 1']) {
      ids.push(
        await seedResource({
          organizationId: venue.organizationId,
          categoryId,
          name,
          workingHours: ALL_WEEK_EIGHT_TO_EIGHT,
        })
      );
    }

    await holdRooms(venue, {
      resourceIds: ids,
      start: onDay(TUE, 10),
      end: onDay(TUE, 11),
      priceCents: TOTAL_CENTS,
      title: 'Holds all three',
    });

    const { rows } = await report(venue.organizationId);
    const attributed = ids.map((id) => rowFor(rows, id));

    // RECONCILIATION: no double-counting (which would give 30 000) and no drift
    // (which a naive `Math.round(total / 3)` would produce at 9999).
    expect(attributed.reduce((sum, row) => sum + row.revenueCents, 0)).toBe(
      TOTAL_CENTS
    );

    const [lowest, ...rest] = [...attributed].sort((a, b) =>
      a.resourceId.localeCompare(b.resourceId)
    );
    expect(lowest.revenueCents).toBe(3334);
    expect(rest.map((row) => row.revenueCents)).toEqual([3333, 3333]);

    // The split is of REVENUE, not of time: all three were occupied the hour.
    for (const row of attributed) expect(row.bookedMinutes).toBe(60);
  });

  it('an appointment with no priced lines contributes 0 revenue but full booked minutes', async () => {
    // A free consultation still occupies the room. Dropping it from the
    // numerator would make a clinic that runs consults look half as busy as it
    // is, and the room it needs would never get bought.
    const venue = await seedVenue();
    const categoryId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Rooms',
    });
    const consultRoom = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Consult room',
      sortOrder: 0,
      workingHours: ALL_WEEK_EIGHT_TO_EIGHT,
    });
    const treatmentRoom = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Treatment room',
      sortOrder: 1,
      workingHours: ALL_WEEK_EIGHT_TO_EIGHT,
    });

    // No cart, so NO `appointment_service` rows exist for this one at all.
    await holdRooms(venue, {
      resourceIds: [consultRoom],
      start: onDay(TUE, 10),
      end: onDay(TUE, 11),
      priceCents: null,
      title: 'Free consultation',
    });
    await holdRooms(venue, {
      resourceIds: [treatmentRoom],
      start: onDay(TUE, 10),
      end: onDay(TUE, 11),
      priceCents: 4200,
      title: 'Paid treatment',
    });

    const { rows } = await report(venue.organizationId);

    const consult = rowFor(rows, consultRoom);
    expect(consult.bookedMinutes).toBe(60);
    expect(consult.revenueCents).toBe(0);
    expect(consult.revenuePerOpenHourCents).toBe(0);

    // The paired priced booking proves revenue attribution is not globally
    // broken, which would make the zero above pass for the wrong reason.
    const treatment = rowFor(rows, treatmentRoom);
    expect(treatment.bookedMinutes).toBe(60);
    expect(treatment.revenueCents).toBe(4200);
  });

  it('cancelled, no-show and soft-deleted appointments contribute nothing, even when their hold LEAKED', async () => {
    const venue = await seedVenue();
    const categoryId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Rooms',
    });
    const roomId = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Room 1',
      workingHours: ALL_WEEK_EIGHT_TO_EIGHT,
    });

    // Each leak is worth as much as the live booking, so a filter that misses
    // ANY of the three reports at least 10 000 instead of 5 000.
    const cancelledId = await holdRooms(venue, {
      resourceIds: [roomId],
      start: onDay(TUE, 10),
      end: onDay(TUE, 11),
      priceCents: 5000,
      title: 'Cancelled',
    });
    const noShowId = await holdRooms(venue, {
      resourceIds: [roomId],
      start: onDay(TUE, 11),
      end: onDay(TUE, 12),
      priceCents: 5000,
      title: 'No-show',
    });
    const deletedId = await holdRooms(venue, {
      resourceIds: [roomId],
      start: onDay(TUE, 12),
      end: onDay(TUE, 13),
      priceCents: 5000,
      title: 'Soft-deleted',
    });
    await holdRooms(venue, {
      resourceIds: [roomId],
      start: onDay(TUE, 13),
      end: onDay(TUE, 14),
      priceCents: 5000,
      title: 'Genuine booking',
    });

    await db
      .update(appointment)
      .set({ status: 'cancelled' })
      .where(eq(appointment.id, cancelledId));
    await db
      .update(appointment)
      .set({ status: 'no_show' })
      .where(eq(appointment.id, noShowId));
    // Still `booked` — soft deletion is a SEPARATE axis from status, and a
    // report that filtered only on status would count this one.
    await db
      .update(appointment)
      .set({ deletedAt: new Date() })
      .where(eq(appointment.id, deletedId));

    const row = rowFor((await report(venue.organizationId)).rows, roomId);
    expect(row.bookedMinutes).toBe(60);
    expect(row.revenueCents).toBe(5000);
  });

  it('ordering falls through to NAME when both sort orders tie', async () => {
    // The third comparator is unreachable unless the first two tie, so nothing
    // else in the suite exercises it — and an unstable order makes two
    // consecutive loads of the same report show rows in different places.
    const venue = await seedVenue();
    const rooms = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Rooms',
      sortOrder: 0,
    });
    const devices = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Devices',
      kind: 'equipment',
      sortOrder: 1,
    });

    // All three share sortOrder 0 — the tie the name comparator exists for.
    const cedar = await seedResource({
      organizationId: venue.organizationId,
      categoryId: rooms,
      name: 'Cedar',
      sortOrder: 0,
    });
    const aloe = await seedResource({
      organizationId: venue.organizationId,
      categoryId: rooms,
      name: 'Aloe',
      sortOrder: 0,
    });
    const bronze = await seedResource({
      organizationId: venue.organizationId,
      categoryId: rooms,
      name: 'Bronze',
      sortOrder: 0,
    });
    // Alphabetically first in the whole org, but its CATEGORY sorts last — so
    // it lands at the bottom, proving category order still dominates the name.
    const aardvark = await seedResource({
      organizationId: venue.organizationId,
      categoryId: devices,
      name: 'Aardvark',
      sortOrder: 0,
    });

    const { rows } = await report(venue.organizationId);
    expect(rows.map((row) => row.resourceName)).toEqual([
      'Aloe',
      'Bronze',
      'Cedar',
      'Aardvark',
    ]);
    expect(rows.map((row) => row.resourceId)).toEqual([
      aloe,
      bronze,
      cedar,
      aardvark,
    ]);
  });

  it('a location-filtered report contains exactly that location plus the location-LESS resources', async () => {
    const venue = await seedVenue();
    const branchA = await seedResourceLocation({
      organizationId: venue.organizationId,
      name: 'Branch A',
      openingHours: ALL_WEEK_EIGHT_TO_EIGHT,
      isPrimary: true,
    });
    const branchB = await seedResourceLocation({
      organizationId: venue.organizationId,
      name: 'Branch B',
      openingHours: ALL_WEEK_EIGHT_TO_EIGHT,
    });
    const categoryId = await seedResourceCategory({
      organizationId: venue.organizationId,
      name: 'Rooms',
    });

    const atA = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Bolted to A',
      locationId: branchA,
      sortOrder: 0,
    });
    const atB = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Bolted to B',
      locationId: branchB,
      sortOrder: 1,
    });
    // A trolley-mounted device: available everywhere, so it belongs in EVERY
    // location's report as well as the unfiltered one.
    const roving = await seedResource({
      organizationId: venue.organizationId,
      categoryId,
      name: 'Roving trolley',
      locationId: null,
      sortOrder: 2,
    });

    expect(
      (await report(venue.organizationId, branchB)).rows.map(
        (row) => row.resourceId
      )
    ).toEqual([atB, roving]);
    // Asserted the other way too, so "the filter drops everything pinned" could
    // not pass for "the filter works".
    expect(
      (await report(venue.organizationId, branchA)).rows.map(
        (row) => row.resourceId
      )
    ).toEqual([atA, roving]);
    expect(
      (await report(venue.organizationId)).rows.map((row) => row.resourceId)
    ).toEqual([atA, atB, roving]);
  });
});
