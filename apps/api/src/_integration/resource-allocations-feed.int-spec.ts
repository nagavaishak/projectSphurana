/**
 * Phase 7 §7g — the rooms calendar's hydration feed.
 *
 * `listAppointmentResources` is the ONE query behind every block the rooms
 * calendar draws. Nothing else hydrates that view, so a defect here is not a
 * subtly wrong number — it is a room that looks free while somebody is in it,
 * or a room that looks occupied and gets no bookings all week. Both are
 * silent: the calendar renders perfectly either way.
 *
 * Behaviour locked here:
 *  - THE WINDOW IS HALF-OPEN, at BOTH ends. A hold ending exactly at `from` is
 *    OUT, a hold starting exactly at `to` is OUT, and a hold straddling either
 *    edge is IN. Off-by-one here duplicates the boundary block onto two
 *    adjacent calendar pages (a room that appears double-booked when it is not)
 *    or drops it from both.
 *  - THE HOLD IS THE RANGE, NOT THE APPOINTMENT. `endDate` already carries the
 *    turnaround tail, so an appointment that finished BEFORE the window still
 *    appears when its cleanup reaches into it. The room genuinely is occupied
 *    then; a feed keyed on the appointment's own end would offer it out.
 *  - EVERY DISPLAY FIELD IS PRESENT. `resourceName`, `resourceColor`,
 *    `categoryId`, `turnaroundMinutes`, `source` and `allowOverlap` are what
 *    the calendar renders with — the lane, the swatch, the grouping, the
 *    hatched cleanup extension, the "manually moved" marker and the
 *    force-override marker. A null `resourceColor` must arrive as an explicit
 *    null (the UI falls back to the category colour), never as a missing key.
 *  - SOFT-DELETED RESOURCES VANISH; DEACTIVATED ONES DO NOT. A retired room has
 *    no lane to draw into. A DEACTIVATED room may still be holding live
 *    bookings that have to be seen and moved — dropping those is how a clinic
 *    loses track of an appointment it still has to honour.
 *  - ORG ISOLATION IS STRICT, asserted in BOTH directions so "returns nothing"
 *    cannot pass for "returns only mine".
 *  - A backwards or empty window is a VALIDATION_ERROR; an empty ANSWER is a
 *    successful `[]`. The calendar's quiet Sunday must not render as an error
 *    state, and `null` would crash `.map()`.
 *  - IT IS ONE QUERY, AND IT IS COMPLETE. 200 allocations across five rooms
 *    come back whole — asserted per resource, so a truncating join or a
 *    per-row lookup that silently drops rows cannot pass.
 */
import { randomUUID } from 'node:crypto';
import {
  appointment,
  appointmentResource,
  db,
  resource,
} from '@borradh-workspace/database';
import { listAppointmentResources } from '@borradh-workspace/features/resources';
import type { AppointmentResourceAllocationView } from '@borradh-workspace/features/resources';
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
  setResourceColor,
} from './seeds/resources.js';

/**
 * The fixture literals below (2026-06-01 …) encode only the RELATIVE structure
 * the window assertions depend on — which holds touch which edge. `at()`
 * rebases them onto a fixed near-future anchor computed once from the real
 * clock, the same trick `appointment-double-booking.int-spec.ts` uses, so no
 * fixture can rot into the past as the calendar year advances.
 */
const FIXTURE_EPOCH_MS = Date.UTC(2026, 5, 1); // earliest literal: 2026-06-01
const FUTURE_ANCHOR_MS = (() => {
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  base.setUTCDate(base.getUTCDate() + 14);
  return base.getTime();
})();
const at = (iso: string) =>
  new Date(new Date(iso).getTime() - FIXTURE_EPOCH_MS + FUTURE_ANCHOR_MS);

/** The calendar page every test below asks about: one working day, 09:00–17:00. */
const WINDOW = {
  from: at('2026-06-01T09:00:00.000Z'),
  to: at('2026-06-01T17:00:00.000Z'),
};

interface Venue {
  organizationId: string;
  categoryId: string;
  assigneeId: string;
  leadId: string;
}

/** An org with a room category and the two rows every appointment needs. */
async function seedVenue(): Promise<Venue> {
  const organizationId = await seedOrganization();
  const assignee = await seedUser();
  return {
    organizationId,
    categoryId: await seedResourceCategory({ organizationId, name: 'Rooms' }),
    assigneeId: assignee.id,
    leadId: await seedLead({ organizationId }),
  };
}

/** A room in this venue's category. */
const room = (
  venue: Venue,
  name: string,
  overrides: Partial<Parameters<typeof seedResource>[0]> = {}
) =>
  seedResource({
    organizationId: venue.organizationId,
    categoryId: venue.categoryId,
    name,
    ...overrides,
  });

/**
 * An appointment plus the hold it places on `resourceId`, in one step.
 *
 * The appointment's OWN dates default to the hold's, but are settable
 * separately: the turnaround test needs an appointment that finished before the
 * window while its hold still reaches into it, and that distinction is the
 * whole reason `appointment_resource` carries its own range.
 */
async function hold(
  venue: Venue,
  input: {
    resourceId: string;
    start: Date;
    end: Date;
    appointmentStart?: Date;
    appointmentEnd?: Date;
    turnaroundMinutes?: number;
    source?: 'auto' | 'manual';
    allowOverlap?: boolean;
    title?: string;
  }
): Promise<{ allocationId: string; appointmentId: string }> {
  const appointmentId = await seedAppointment({
    organizationId: venue.organizationId,
    assignedToId: venue.assigneeId,
    leadId: venue.leadId,
    title: input.title ?? 'Held',
    startDate: input.appointmentStart ?? input.start,
    endDate: input.appointmentEnd ?? input.end,
  });
  const allocationId = await seedAllocation({
    organizationId: venue.organizationId,
    appointmentId,
    resourceId: input.resourceId,
    startDate: input.start,
    endDate: input.end,
    turnaroundMinutes: input.turnaroundMinutes,
    source: input.source,
    allowOverlap: input.allowOverlap,
  });
  return { allocationId, appointmentId };
}

/** The feed, for the standard window unless overridden. */
async function feed(
  organizationId: string,
  window: { from: Date; to: Date } = WINDOW
): Promise<AppointmentResourceAllocationView[]> {
  const result = await listAppointmentResources(db, {
    organizationId,
    from: window.from,
    to: window.to,
  });
  if (!result.success) throw new Error(result.error.message);
  return result.data;
}

const idsOf = (rows: AppointmentResourceAllocationView[]) =>
  rows.map((row) => row.id).sort();

describe('Phase 7 §7g — rooms calendar allocation feed', () => {
  it('the window is half-open at BOTH edges', async () => {
    const venue = await seedVenue();

    // One room per case: the exclusion constraint would refuse two of these on
    // the same resource, and separate lanes make the failure message legible.
    const endsAtFrom = await hold(venue, {
      resourceId: await room(venue, 'Ends exactly at the window start'),
      start: at('2026-06-01T07:00:00.000Z'),
      end: WINDOW.from,
    });
    const startsAtTo = await hold(venue, {
      resourceId: await room(venue, 'Starts exactly at the window end'),
      start: WINDOW.to,
      end: at('2026-06-01T19:00:00.000Z'),
    });
    const straddlesStart = await hold(venue, {
      resourceId: await room(venue, 'Straddles the window start'),
      start: at('2026-06-01T08:00:00.000Z'),
      end: at('2026-06-01T10:00:00.000Z'),
    });
    const straddlesEnd = await hold(venue, {
      resourceId: await room(venue, 'Straddles the window end'),
      start: at('2026-06-01T16:00:00.000Z'),
      end: at('2026-06-01T18:00:00.000Z'),
    });
    const encloses = await hold(venue, {
      resourceId: await room(venue, 'Encloses the whole window'),
      start: at('2026-06-01T06:00:00.000Z'),
      end: at('2026-06-01T20:00:00.000Z'),
    });
    const inside = await hold(venue, {
      resourceId: await room(venue, 'Entirely inside'),
      start: at('2026-06-01T11:00:00.000Z'),
      end: at('2026-06-01T12:00:00.000Z'),
    });

    const rows = await feed(venue.organizationId);

    expect(idsOf(rows)).toEqual(
      [
        straddlesStart.allocationId,
        straddlesEnd.allocationId,
        encloses.allocationId,
        inside.allocationId,
      ].sort()
    );
    // Stated again the other way round, because "absent" is the assertion that
    // a broken `<=` would flip and an id-set comparison can be hard to read.
    expect(idsOf(rows)).not.toContain(endsAtFrom.allocationId);
    expect(idsOf(rows)).not.toContain(startsAtTo.allocationId);
  });

  it('a hold whose TURNAROUND TAIL reaches into the window is included', async () => {
    // The appointment itself is over before the calendar page begins. Only the
    // cleanup tail overlaps — and the room really is occupied during it, so the
    // block has to be drawn. A feed keyed on `appointment.endDate` would offer
    // this room out at 09:00 while a therapist was still stripping the bed.
    const venue = await seedVenue();
    const roomId = await room(venue, 'Room 1');

    const { allocationId, appointmentId } = await hold(venue, {
      resourceId: roomId,
      appointmentStart: at('2026-06-01T07:00:00.000Z'),
      appointmentEnd: at('2026-06-01T08:00:00.000Z'),
      start: at('2026-06-01T07:00:00.000Z'),
      end: at('2026-06-01T09:30:00.000Z'),
      turnaroundMinutes: 90,
    });

    // The premise, asserted rather than assumed: the APPOINTMENT does not
    // overlap the window at all.
    const [appointmentRow] = await db
      .select({ endDate: appointment.endDate })
      .from(appointment)
      .where(eq(appointment.id, appointmentId));
    expect(appointmentRow.endDate.getTime()).toBeLessThan(
      WINDOW.from.getTime()
    );

    const rows = await feed(venue.organizationId);
    expect(idsOf(rows)).toEqual([allocationId]);
    // The tail is carried separately so the calendar can hatch it rather than
    // draw it as bookable time.
    expect(rows[0].turnaroundMinutes).toBe(90);
    expect(rows[0].endDate.toISOString()).toBe(
      at('2026-06-01T09:30:00.000Z').toISOString()
    );
  });

  it('returns every display field the calendar renders with', async () => {
    const venue = await seedVenue();
    const roomId = await room(venue, 'Room 2 — back corridor');
    await setResourceColor(roomId, 'purple');

    const { allocationId, appointmentId } = await hold(venue, {
      resourceId: roomId,
      start: at('2026-06-01T10:00:00.000Z'),
      end: at('2026-06-01T11:15:00.000Z'),
      turnaroundMinutes: 15,
      // A staff force-override: moved by hand, and opted out of the exclusion
      // constraint. Both are rendered differently, so both must survive the
      // trip.
      source: 'manual',
      allowOverlap: true,
    });

    const rows = await feed(venue.organizationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: allocationId,
      appointmentId,
      resourceId: roomId,
      resourceName: 'Room 2 — back corridor',
      resourceColor: 'purple',
      categoryId: venue.categoryId,
      startDate: at('2026-06-01T10:00:00.000Z'),
      endDate: at('2026-06-01T11:15:00.000Z'),
      turnaroundMinutes: 15,
      source: 'manual',
      allowOverlap: true,
    });
  });

  it('an uncoloured resource yields an explicit null colour, not a missing key', async () => {
    // The calendar falls back to the category's colour when a room has none of
    // its own. `undefined` disappears through JSON and the swatch renders
    // transparent, which reads as a rendering bug rather than as a default.
    const venue = await seedVenue();
    const { allocationId } = await hold(venue, {
      resourceId: await room(venue, 'Unpainted room'),
      start: at('2026-06-01T10:00:00.000Z'),
      end: at('2026-06-01T11:00:00.000Z'),
    });

    const rows = await feed(venue.organizationId);
    expect(idsOf(rows)).toEqual([allocationId]);
    expect(rows[0].resourceColor).toBeNull();
    expect(Object.hasOwn(rows[0], 'resourceColor')).toBe(true);
  });

  it('soft-deleted resources are excluded — but DEACTIVATED ones still render', async () => {
    const venue = await seedVenue();
    const liveRoom = await room(venue, 'Live');
    const retiredRoom = await room(venue, 'Retired', { deletedAt: new Date() });
    const deactivatedRoom = await room(venue, 'Deactivated', {
      isActive: false,
    });

    const live = await hold(venue, {
      resourceId: liveRoom,
      start: at('2026-06-01T10:00:00.000Z'),
      end: at('2026-06-01T11:00:00.000Z'),
    });
    const retired = await hold(venue, {
      resourceId: retiredRoom,
      start: at('2026-06-01T10:00:00.000Z'),
      end: at('2026-06-01T11:00:00.000Z'),
    });
    const deactivated = await hold(venue, {
      resourceId: deactivatedRoom,
      start: at('2026-06-01T10:00:00.000Z'),
      end: at('2026-06-01T11:00:00.000Z'),
    });

    // The retired room's allocation is genuinely still in the table, so the
    // assertion below is about the JOIN filtering it out — not about the row
    // never having existed.
    const [stillThere] = await db
      .select({ id: appointmentResource.id })
      .from(appointmentResource)
      .where(eq(appointmentResource.id, retired.allocationId));
    expect(stillThere?.id).toBe(retired.allocationId);

    const rows = await feed(venue.organizationId);
    expect(idsOf(rows)).toEqual(
      [live.allocationId, deactivated.allocationId].sort()
    );
    expect(idsOf(rows)).not.toContain(retired.allocationId);
  });

  it('is strictly org-scoped, in both directions', async () => {
    const mine = await seedVenue();
    const theirs = await seedVenue();

    const myHold = await hold(mine, {
      resourceId: await room(mine, 'My room'),
      start: at('2026-06-01T10:00:00.000Z'),
      end: at('2026-06-01T11:00:00.000Z'),
    });
    const theirHold = await hold(theirs, {
      resourceId: await room(theirs, 'Their room'),
      start: at('2026-06-01T10:00:00.000Z'),
      end: at('2026-06-01T11:00:00.000Z'),
    });

    // Asserted BOTH ways: a query that returned nothing at all would satisfy
    // only the first half.
    expect(idsOf(await feed(mine.organizationId))).toEqual([
      myHold.allocationId,
    ]);
    expect(idsOf(await feed(theirs.organizationId))).toEqual([
      theirHold.allocationId,
    ]);
  });

  it('a backwards or zero-width window is a VALIDATION_ERROR', async () => {
    const venue = await seedVenue();

    const backwards = await listAppointmentResources(db, {
      organizationId: venue.organizationId,
      from: WINDOW.to,
      to: WINDOW.from,
    });
    expect(backwards.success).toBe(false);
    if (backwards.success) throw new Error('expected a validation failure');
    expect(backwards.error.code).toBe('VALIDATION_ERROR');

    // `to === from` is the boundary of that rule: a half-open window of zero
    // width can never contain anything, so asking for one is a caller bug.
    const zeroWidth = await listAppointmentResources(db, {
      organizationId: venue.organizationId,
      from: WINDOW.from,
      to: WINDOW.from,
    });
    expect(zeroWidth.success).toBe(false);
    if (zeroWidth.success) throw new Error('expected a validation failure');
    expect(zeroWidth.error.code).toBe('VALIDATION_ERROR');
  });

  it('a window with nothing in it succeeds with [] — never null, never a throw', async () => {
    // The quiet Sunday. `null` would crash the calendar's `.map()`, and an
    // error result would render an alarming failure state over an empty grid.
    const venue = await seedVenue();
    await hold(venue, {
      resourceId: await room(venue, 'Busy on the Monday'),
      start: at('2026-06-01T10:00:00.000Z'),
      end: at('2026-06-01T11:00:00.000Z'),
    });

    const result = await listAppointmentResources(db, {
      organizationId: venue.organizationId,
      // The following day, on which nothing is booked.
      from: at('2026-06-02T00:00:00.000Z'),
      to: at('2026-06-03T00:00:00.000Z'),
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data).toEqual([]);

    // …and the fixture is not vacuous: the Monday's hold is really there.
    expect(await feed(venue.organizationId)).toHaveLength(1);
  });

  it('200 allocations across five rooms come back complete', async () => {
    // A busy clinic's week. The point is not speed, it is COMPLETENESS: this is
    // one query with one join, and a truncating join or a swallowed per-row
    // lookup would show up as a short result rather than as an error.
    const venue = await seedVenue();
    const ROOM_COUNT = 5;
    const SLOT_COUNT = 40;

    const roomIds: string[] = [];
    for (let i = 0; i < ROOM_COUNT; i += 1) {
      roomIds.push(await room(venue, `Room ${i + 1}`, { sortOrder: i }));
    }

    const volumeWindow = {
      from: at('2026-06-08T00:00:00.000Z'),
      to: at('2026-06-09T00:00:00.000Z'),
    };

    // One appointment per slot, holding every room at once (a whole-clinic
    // block), so 40 appointments produce 200 allocation rows. Slots are 30
    // minutes and back-to-back; `tstzrange` is `[)`, so adjacent holds do not
    // trip `resource_no_overlap`.
    const appointmentRows: (typeof appointment.$inferInsert)[] = [];
    const allocationRows: (typeof appointmentResource.$inferInsert)[] = [];
    const expectedIds: string[] = [];

    for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
      const appointmentId = `appt_${randomUUID()}`;
      const start = new Date(volumeWindow.from.getTime() + slot * 30 * 60_000);
      const end = new Date(start.getTime() + 30 * 60_000);
      appointmentRows.push({
        id: appointmentId,
        organizationId: venue.organizationId,
        assignedToId: venue.assigneeId,
        leadId: venue.leadId,
        title: `Slot ${slot}`,
        startDate: start,
        endDate: end,
      });
      for (const resourceId of roomIds) {
        const allocationId = `ares_${randomUUID()}`;
        expectedIds.push(allocationId);
        allocationRows.push({
          id: allocationId,
          organizationId: venue.organizationId,
          appointmentId,
          resourceId,
          startDate: start,
          endDate: end,
        });
      }
    }

    await db.insert(appointment).values(appointmentRows);
    await db.insert(appointmentResource).values(allocationRows);

    const rows = await feed(venue.organizationId, volumeWindow);

    expect(rows).toHaveLength(ROOM_COUNT * SLOT_COUNT); // 200
    expect(idsOf(rows)).toEqual([...expectedIds].sort());

    // Per resource, so a join that dropped one room's lane entirely — which a
    // bare length check on a 200-row result would still pass if it dropped a
    // room and duplicated another — cannot slip through.
    const nameById = new Map(
      (
        await db
          .select({ id: resource.id, name: resource.name })
          .from(resource)
          .where(eq(resource.organizationId, venue.organizationId))
      ).map((row) => [row.id, row.name])
    );
    for (const resourceId of roomIds) {
      const forRoom = rows.filter((row) => row.resourceId === resourceId);
      expect(forRoom).toHaveLength(SLOT_COUNT);
      // Every row is HYDRATED, not just present.
      for (const row of forRoom) {
        expect(row.resourceName).toBe(nameById.get(resourceId));
        expect(row.categoryId).toBe(venue.categoryId);
      }
    }
  });
});
