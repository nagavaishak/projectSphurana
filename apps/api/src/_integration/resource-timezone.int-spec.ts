/**
 * Phase 7 §7c/§7h — rooms across time zones: the one that bites in production.
 *
 * Every Borradh clinic is in Europe/Dublin and every database column is UTC.
 * A resource's `workingHours` are WALL CLOCK — "09:00" means what the sign on
 * the door says — so the UTC instant they resolve to MOVES twice a year. Get
 * this wrong and nothing throws: rooms simply run an hour early for half the
 * year, a whole week's utilisation is off by an hour a day, and the cleanup
 * tail on a late booking silently stops holding the room after local midnight.
 *
 * `resource-availability-gating.int-spec.ts` locks the October transition for
 * the availability resolver. This file locks the rest of the surface — the two
 * stable halves of the year, the REPORT's day-walking arithmetic, the gate's
 * indifference to the machine's own zone, and a hold that crosses local
 * midnight.
 *
 * Behaviour locked here:
 *  - THE SAME STORED HOURS ARE TWO DIFFERENT UTC INSTANTS. 09:00–17:00 Dublin
 *    is 08:00Z–16:00Z in July (IST, UTC+1) and 09:00Z–17:00Z in January (GMT).
 *    A naive reading of the stored minutes as UTC is right for exactly one of
 *    those and looks entirely plausible for both.
 *  - THE REPORT COUNTS WALL-CLOCK HOURS, NOT ELAPSED UTC. The week containing
 *    the October transition is 169 hours long, and a clinic that worked
 *    09:00–17:00 every day of it worked 7 × 8 hours — not the 7 × 8 + 1 that
 *    UTC-day arithmetic produces when the window edges are clipped mid-day.
 *  - A DST SUNDAY IS GENUINELY 23 OR 25 HOURS LONG. Stored "00:00–06:00" is
 *    FIVE real hours on the spring-forward Sunday and SEVEN on the autumn one.
 *    That is not a rounding artefact, it is how long the room was actually
 *    open, and it is the figure staff are paid against.
 *  - THE ANSWER DOES NOT DEPEND ON THE SERVER'S ZONE. The same gate question is
 *    asked with `process.env.TZ` set to `Pacific/Kiritimati` (UTC+14, the
 *    furthest zone from Dublin there is) and must answer identically. A single
 *    `new Date(y, m, d)` or `toISOString().slice(0, 10)` anywhere in the chain
 *    fails this and passes everything else, because CI runs in UTC.
 *  - A TURNAROUND TAIL CROSSING LOCAL MIDNIGHT STILL HOLDS THE ROOM. The
 *    23:30 booking's cleanup runs to 00:45 the next local day; the room is not
 *    free at 00:30 and is free at 00:45.
 *
 * FIXED ABSOLUTE DATES, deliberately, and not rebased through an `at()` anchor:
 * every assertion below is about a SPECIFIC DST boundary or a specific offset,
 * and shifting the fixture by an arbitrary delta would slide it off the thing
 * it exists to straddle. 2030 is far enough out that the future-dated bookings
 * clear `createAppointment`'s past-booking backstop — the same convention
 * `resource-utilisation.int-spec.ts` and the gating spec's DST case use.
 */
import { db } from '@borradh-workspace/database';
import { createAppointment } from '@borradh-workspace/features/appointments';
import { getResourceUtilisation } from '@borradh-workspace/features/resources';
import {
  type ResourceGateContext,
  hasFreeResourcesFor,
  loadResourceGateContext,
  resolveResourceAvailability,
} from '@borradh-workspace/features/scheduling';
import { seedLead, seedOrganization, seedUser } from './harness.js';
import {
  allocationsFor,
  seedRequirement,
  seedResource,
  seedResourceCategory,
  seedResourceService,
} from './seeds/resources.js';

const DUBLIN = 'Europe/Dublin';

/** 09:00–17:00, every day of the week. */
const NINE_TO_FIVE_DAILY = Object.fromEntries(
  [0, 1, 2, 3, 4, 5, 6].map((day) => [day, { from: 9 * 60, to: 17 * 60 }])
) as never;

/** Midnight to 06:00 on SUNDAYS only — the day both transitions land on. */
const SUNDAY_MIDNIGHT_TO_SIX = { 0: { from: 0, to: 6 * 60 } } as never;

const iso = (value: Date) => value.toISOString();

/** The wall clock a UTC instant reads as in Dublin, e.g. `2030-07-16 00:45`. */
const dublinWallClock = (instant: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: DUBLIN,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(instant)
    .replace(',', '');

/** A Dublin org with one room category. */
async function seedDublinVenue(): Promise<{
  organizationId: string;
  categoryId: string;
  assigneeId: string;
  leadId: string;
}> {
  const organizationId = await seedOrganization({ timezone: DUBLIN });
  const assignee = await seedUser();
  return {
    organizationId,
    categoryId: await seedResourceCategory({ organizationId, name: 'Rooms' }),
    assigneeId: assignee.id,
    leadId: await seedLead({ organizationId }),
  };
}

/** Working intervals for one resource, as `[startISO, endISO]` pairs. */
async function workingRanges(
  organizationId: string,
  resourceId: string,
  from: Date,
  to: Date
): Promise<string[][]> {
  const [availability] = await resolveResourceAvailability(db, {
    organizationId,
    resourceIds: [resourceId],
    from,
    to,
    timeZone: DUBLIN,
  });
  return availability.working.map((range) => [
    iso(range.start),
    iso(range.end),
  ]);
}

async function utilisationRow(
  organizationId: string,
  resourceId: string,
  from: Date,
  to: Date
) {
  const result = await getResourceUtilisation(db, {
    organizationId,
    from,
    to,
  });
  if (!result.success) throw new Error(result.error.message);
  const row = result.data.rows.find((r) => r.resourceId === resourceId);
  if (!row) throw new Error(`resource ${resourceId} missing from the report`);
  return row;
}

function requireGate(ctx: ResourceGateContext | null): ResourceGateContext {
  if (ctx === null) {
    throw new Error(
      'expected a resource gate context — the requirement rows were not seeded'
    );
  }
  return ctx;
}

describe('Phase 7 — resources across time zones', () => {
  it('a Dublin room’s 09:00 is 08:00Z in JULY (IST) and 09:00Z in JANUARY (GMT)', async () => {
    // The same stored minutes, the same resource, two different UTC answers.
    // Asserting only one half of the year is how an implementation that reads
    // the stored value as UTC passes a test suite and fails a clinic.
    const venue = await seedDublinVenue();
    const roomId = await seedResource({
      organizationId: venue.organizationId,
      categoryId: venue.categoryId,
      name: 'Dublin room',
      workingHours: NINE_TO_FIVE_DAILY,
    });

    // Monday 2030-07-15, deep in summer time.
    expect(
      await workingRanges(
        venue.organizationId,
        roomId,
        new Date('2030-07-15T00:00:00.000Z'),
        new Date('2030-07-16T00:00:00.000Z')
      )
    ).toEqual([['2030-07-15T08:00:00.000Z', '2030-07-15T16:00:00.000Z']]);

    // Monday 2030-01-14, deep in winter time. Same record, one hour later in
    // UTC — and the room is open for the same eight hours either way.
    expect(
      await workingRanges(
        venue.organizationId,
        roomId,
        new Date('2030-01-14T00:00:00.000Z'),
        new Date('2030-01-15T00:00:00.000Z')
      )
    ).toEqual([['2030-01-14T09:00:00.000Z', '2030-01-14T17:00:00.000Z']]);
  });

  it('a DST Sunday is genuinely 23 or 25 hours long: stored 00:00–06:00 is 5 real hours in spring and 7 in autumn', async () => {
    // The sharpest statement of the rule. Naive UTC arithmetic answers 360
    // minutes on BOTH days; the honest answer is how long the room was actually
    // open, which differs by two hours between them.
    const venue = await seedDublinVenue();
    const roomId = await seedResource({
      organizationId: venue.organizationId,
      categoryId: venue.categoryId,
      name: 'Sunday early shift',
      workingHours: SUNDAY_MIDNIGHT_TO_SIX,
    });

    // Spring forward is 2030-03-31 at 01:00Z: 01:00 GMT becomes 02:00 IST, so
    // 01:00 local never happens and 00:00→06:00 is FIVE hours. The window
    // brackets the Sunday with the neighbouring days, which have no hours.
    const spring = await utilisationRow(
      venue.organizationId,
      roomId,
      new Date('2030-03-30T00:00:00.000Z'), // Saturday
      new Date('2030-04-01T00:00:00.000Z') // Monday
    );
    expect(spring.openMinutes).toBe(5 * 60); // 300
    expect(spring.openMinutes).not.toBe(6 * 60); // what naive UTC would say

    // Autumn back is 2030-10-27 at 01:00Z: 02:00 IST becomes 01:00 GMT, so
    // 01:00 local happens twice and 00:00→06:00 is SEVEN hours.
    const autumn = await utilisationRow(
      venue.organizationId,
      roomId,
      new Date('2030-10-26T00:00:00.000Z'), // Saturday
      new Date('2030-10-28T00:00:00.000Z') // Monday
    );
    expect(autumn.openMinutes).toBe(7 * 60); // 420
    expect(autumn.openMinutes).not.toBe(6 * 60);
  });

  it('a 169-hour week still contains 7 × 8 wall-clock hours of opening', async () => {
    // The reporting week runs local-noon Monday to local-noon Monday across the
    // autumn transition, so it is 169 UTC hours long and BOTH edges clip a
    // partial day. That is the arrangement that separates wall-clock day
    // walking from UTC day walking: a UTC-day implementation clips the first
    // Monday an hour late and reports 3420 minutes for a week in which the
    // clinic worked 3360.
    const venue = await seedDublinVenue();
    const roomId = await seedResource({
      organizationId: venue.organizationId,
      categoryId: venue.categoryId,
      name: 'Dublin room',
      workingHours: NINE_TO_FIVE_DAILY,
    });

    // 12:00 Dublin on Monday 2030-10-21 (IST) …
    const from = new Date('2030-10-21T11:00:00.000Z');
    // … to 12:00 Dublin on Monday 2030-10-28 (GMT).
    const to = new Date('2030-10-28T12:00:00.000Z');

    // The premise, asserted rather than asserted-in-a-comment: this really is a
    // 25-hour-Sunday week.
    expect((to.getTime() - from.getTime()) / 3_600_000).toBe(169);
    expect(dublinWallClock(from)).toBe('2030-10-21 12:00');
    expect(dublinWallClock(to)).toBe('2030-10-28 12:00');

    const row = await utilisationRow(venue.organizationId, roomId, from, to);
    // Monday 12:00–17:00 (300) + six full days (2880) + Monday 09:00–12:00
    // (180) = seven eight-hour days.
    expect(row.openMinutes).toBe(7 * 8 * 60); // 3360
    expect(row.openMinutes).not.toBe(3420); // the naive-UTC answer
  });

  it('a 09:00 Dublin booking gates identically whatever zone the server runs in', async () => {
    // CI runs in UTC, which is one hour from Dublin — small enough that an
    // implicit `new Date(y, m, d)` still lands on the right calendar day and
    // the bug hides. Kiritimati is UTC+14: any implicit local-time arithmetic
    // lands on the WRONG DAY entirely and the assertion below diverges.
    const venue = await seedDublinVenue();
    const serviceId = await seedResourceService({
      organizationId: venue.organizationId,
      appointmentDuration: 60,
    });
    await seedResource({
      organizationId: venue.organizationId,
      categoryId: venue.categoryId,
      name: 'Dublin room',
      workingHours: NINE_TO_FIVE_DAILY,
    });
    await seedRequirement({
      organizationId: venue.organizationId,
      serviceId,
      categoryId: venue.categoryId,
    });

    // Monday 2030-07-15, summer time: the room's day is 08:00Z–16:00Z.
    const window = {
      organizationId: venue.organizationId,
      serviceIds: [serviceId],
      from: new Date('2030-07-15T00:00:00.000Z'),
      to: new Date('2030-07-16T00:00:00.000Z'),
      timeZone: DUBLIN,
    };

    /** Is 09:00 Dublin servable? Is 08:00 Dublin (before opening)? */
    const ask = async () => {
      const ctx = requireGate(await loadResourceGateContext(db, window));
      return {
        // 09:00–10:00 Dublin, inside the room's day.
        nineAm: hasFreeResourcesFor(
          ctx,
          new Date('2030-07-15T08:00:00.000Z'),
          new Date('2030-07-15T09:00:00.000Z')
        ),
        // 08:00–09:00 Dublin, before it opens.
        eightAm: hasFreeResourcesFor(
          ctx,
          new Date('2030-07-15T07:00:00.000Z'),
          new Date('2030-07-15T08:00:00.000Z')
        ),
      };
    };

    const inUtc = await ask();
    // The baseline is meaningful in its own right: opening time is respected.
    expect(inUtc).toEqual({ nineAm: true, eightAm: false });

    const originalTz = process.env.TZ;
    let hostile: Awaited<ReturnType<typeof ask>>;
    try {
      // UTC+14 — the furthest any inhabited zone gets from Dublin.
      process.env.TZ = 'Pacific/Kiritimati';
      hostile = await ask();
    } finally {
      // `process.env.TZ = undefined` would store the STRING "undefined" and
      // leave the process in a zone that does not exist, poisoning every test
      // that runs after this one in the same worker.
      if (originalTz === undefined) Reflect.deleteProperty(process.env, 'TZ');
      else process.env.TZ = originalTz;
    }

    expect(hostile).toEqual(inUtc);
  });

  it('a turnaround tail crossing LOCAL midnight still holds the room', async () => {
    // A 23:30 booking with 45 minutes of cleanup holds the room until 00:45 the
    // next local day. Any implementation that bounds a hold by its own calendar
    // day frees the room at midnight and books someone into a room still being
    // stripped.
    const venue = await seedDublinVenue();
    const serviceId = await seedResourceService({
      organizationId: venue.organizationId,
      appointmentDuration: 30,
      turnaroundMinutes: 45,
    });
    await seedResource({
      organizationId: venue.organizationId,
      categoryId: venue.categoryId,
      name: 'Late room',
      // Null = always available, so the hold is bounded by the booking and its
      // tail rather than by a working interval that stops at midnight.
      workingHours: null,
    });
    await seedRequirement({
      organizationId: venue.organizationId,
      serviceId,
      categoryId: venue.categoryId,
    });

    // 23:30–00:00 Dublin on Monday 2030-07-15 (IST, UTC+1).
    const created = await createAppointment(db, {
      title: 'Last appointment of the day',
      startDate: new Date('2030-07-15T22:30:00.000Z'),
      endDate: new Date('2030-07-15T23:00:00.000Z'),
      leadId: venue.leadId,
      assignedToId: venue.assigneeId,
      organizationId: venue.organizationId,
      serviceId,
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error(created.error.message);
    expect(created.data.resources).toHaveLength(1);

    const [allocation] = await allocationsFor(created.data.id);
    expect(allocation.turnaroundMinutes).toBe(45);
    expect(iso(allocation.endDate)).toBe('2030-07-15T23:45:00.000Z');
    // The whole point, said in wall clock: the booking is on the 15th and the
    // hold ends on the 16th.
    expect(dublinWallClock(allocation.startDate)).toBe('2030-07-15 23:30');
    expect(dublinWallClock(allocation.endDate)).toBe('2030-07-16 00:45');

    // The gate window spans both local days, or the tail would fall off the end
    // of it and the assertions below would pass vacuously.
    const ctx = requireGate(
      await loadResourceGateContext(db, {
        organizationId: venue.organizationId,
        serviceIds: [serviceId],
        from: new Date('2030-07-15T00:00:00.000Z'),
        to: new Date('2030-07-17T00:00:00.000Z'),
        timeZone: DUBLIN,
      })
    );

    // 00:30–01:00 Dublin on the 16th: still inside the previous booking's tail.
    expect(
      hasFreeResourcesFor(
        ctx,
        new Date('2030-07-15T23:30:00.000Z'),
        new Date('2030-07-16T00:00:00.000Z')
      )
    ).toBe(false);

    // 00:45–01:15 Dublin: the tail has just finished, and the room is free.
    expect(
      hasFreeResourcesFor(
        ctx,
        new Date('2030-07-15T23:45:00.000Z'),
        new Date('2030-07-16T00:15:00.000Z')
      )
    ).toBe(true);
  });
});
