// Imported from the module directly, not the tool-factory barrel: the barrel
// reaches `confirmation.ts` → the database package, which this spec has no
// business booting.
import { ApiFetchError, type ApiFetchFn } from '../tool-factory/api-fetch.js';
import { createAvailabilityPort } from './availability.adapter.js';
import type { ResourceReader } from './resource-availability.reader.js';

/**
 * The fifth source, stubbed. `notApplicable` is the reading every org that has
 * never configured a room gets, and it is the one that must keep those orgs on
 * the complete-`read` path — so most tests below use it as the neutral default
 * rather than omitting the reader, which would (correctly) make everything
 * `partially_read`.
 */
const notApplicable: ResourceReader = async () => ({
  status: 'not_applicable',
});

const WINDOW = { from: '2026-03-02', to: '2026-03-04' } as const;

type Routes = Partial<
  Record<'shifts' | 'blocked' | 'timeOff' | 'hours', unknown>
>;

/**
 * `apiFetch` stub that serves each of the four availability reads, or throws
 * for any route whose key is absent — which is how a source is made unreadable.
 */
function stub(routes: Routes, throwFor: (keyof Routes)[] = [], status = 500) {
  const fn = (async (pathArg: string) => {
    const key: keyof Routes = pathArg.startsWith('shifts')
      ? 'shifts'
      : pathArg.startsWith('blocked-time')
        ? 'blocked'
        : pathArg.startsWith('time-off')
          ? 'timeOff'
          : 'hours';
    if (throwFor.includes(key)) {
      throw new ApiFetchError(`boom: ${key}`, status);
    }
    return routes[key] ?? [];
  }) as unknown as ApiFetchFn;
  return fn;
}

const workingDay = (date: string, practitionerId = 'p1') => ({
  practitionerId,
  date,
  dayOfWeek: 1,
  isOff: false,
  source: 'weekly' as const,
  intervals: [
    { shiftId: 's1', startMinutes: 540, endMinutes: 1020, locationId: null },
  ],
});

describe('availability port', () => {
  it('reports a clean window as `read` — the only status that may say so', async () => {
    const port = createAvailabilityPort({
      apiFetch: stub({
        shifts: [workingDay('2026-03-02'), workingDay('2026-03-03')],
        blocked: [],
        timeOff: [],
      }),
      readResources: notApplicable,
    });

    // A location is supplied so all five sources are genuinely checked.
    const result = await port.explainAvailability({
      ...WINDOW,
      locationId: 'loc-1',
    });

    expect(result.status).toBe('read');
    if (result.status !== 'read') return;
    expect(result.blockers).toEqual([]);
    expect(result.bookableDates).toEqual(['2026-03-02', '2026-03-03']);
    // A clinic with no rooms configured is not "checked and clear" — the
    // question does not arise. Reporting it as checked would have Claire
    // volunteer a room story for a business that has no rooms.
    expect(result.resources).toEqual({ kind: 'not_applicable' });
  });

  it('an unreadable source makes the result `partially_read`, never `read`', async () => {
    // THE load-bearing property. Three sources come back clean; blocked-time
    // faults. Reporting "nothing is blocking" here is the exact failure this
    // port exists to prevent — the owner acts on it and the booking still
    // fails.
    const port = createAvailabilityPort({
      apiFetch: stub({ shifts: [workingDay('2026-03-02')], timeOff: [] }, [
        'blocked',
      ]),
      readResources: notApplicable,
    });

    const result = await port.explainAvailability({
      ...WINDOW,
      locationId: 'loc-1',
    });

    expect(result.status).toBe('partially_read');
    if (result.status !== 'partially_read') return;
    expect(result.unread).toContain('blockedTime');
    expect(result.blockers).toEqual([]);
    // There is no member in which an unread source coexists with a clean
    // verdict, so a consumer cannot phrase this as "all clear".
    expect(result).not.toHaveProperty('status', 'read');
  });

  it('omitting locationId marks opening hours UNREAD rather than assuming open', async () => {
    const port = createAvailabilityPort({
      apiFetch: stub({
        shifts: [workingDay('2026-03-02')],
        blocked: [],
        timeOff: [],
      }),
      readResources: notApplicable,
    });

    const result = await port.explainAvailability(WINDOW);

    expect(result.status).toBe('partially_read');
    if (result.status !== 'partially_read') return;
    expect(result.unread).toEqual(['openingHours']);
  });

  it('distinguishes NO ROTA from a day marked off', async () => {
    // Different problems with different fixes: "create a rota" vs "this day is
    // off". Collapsing them is why an owner is told to change a shift that
    // does not exist.
    const empty = createAvailabilityPort({
      apiFetch: stub({ shifts: [], blocked: [], timeOff: [] }),
      readResources: notApplicable,
    });
    const emptyResult = await empty.explainAvailability({
      ...WINDOW,
      locationId: 'loc-1',
    });
    expect(emptyResult.status).not.toBe('blocked');
    if (emptyResult.status === 'blocked') return;
    expect(emptyResult.blockers.map((b) => b.kind)).toEqual(['no_shifts']);

    const off = createAvailabilityPort({
      apiFetch: stub({
        shifts: [{ ...workingDay('2026-03-02'), isOff: true, intervals: [] }],
        blocked: [],
        timeOff: [],
      }),
      readResources: notApplicable,
    });
    const offResult = await off.explainAvailability({
      ...WINDOW,
      locationId: 'loc-1',
    });
    if (offResult.status === 'blocked') return;
    expect(offResult.blockers.map((b) => b.kind)).toEqual(['day_off']);
  });

  it('when every source fails it is `blocked` — nothing was learned', async () => {
    // Distinct from a partial read: a partial read has findings, this has none.
    const port = createAvailabilityPort({
      apiFetch: stub({}, ['shifts', 'blocked', 'timeOff', 'hours']),
      readResources: async () => ({ status: 'unread', fault: 'boom' }),
    });

    const result = await port.explainAvailability({
      ...WINDOW,
      locationId: 'loc-1',
    });

    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;
    expect(result.reason.kind).toBe('server_error');
  });

  it('a 4xx is a stated reason, not a server fault', async () => {
    const port = createAvailabilityPort({
      apiFetch: stub({}, ['shifts', 'blocked', 'timeOff', 'hours'], 404),
      readResources: async () => ({ status: 'unread' }),
    });

    const result = await port.explainAvailability({
      ...WINDOW,
      locationId: 'loc-1',
    });

    if (result.status !== 'blocked') throw new Error('expected blocked');
    // Only the fault side may page someone.
    expect(result.reason.kind).toBe('other');
  });

  it('refuses an inverted window without calling anything', async () => {
    const apiFetch = jest.fn();
    const port = createAvailabilityPort({
      apiFetch: apiFetch as unknown as ApiFetchFn,
      readResources: notApplicable,
    });

    const result = await port.explainAvailability({
      from: '2026-03-04',
      to: '2026-03-02',
    });

    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;
    expect(result.reason.kind).toBe('invalid_window');
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('does not report a bookable date that a blocker covers', async () => {
    const port = createAvailabilityPort({
      apiFetch: stub({
        shifts: [workingDay('2026-03-02'), workingDay('2026-03-03')],
        blocked: [
          {
            id: 'bt-1',
            organizationId: 'org-1',
            title: 'Team training',
            startDate: '2026-03-03T09:00:00.000Z',
            endDate: '2026-03-03T17:00:00.000Z',
            practitionerIds: [],
          },
        ],
        timeOff: [],
      }),
      readResources: notApplicable,
    });

    const result = await port.explainAvailability({
      ...WINDOW,
      locationId: 'loc-1',
    });

    if (result.status === 'blocked') throw new Error('expected a read');
    expect(result.bookableDates).toEqual(['2026-03-02']);
    expect(result.blockers.map((b) => b.kind)).toContain('blocked_time');
  });
});

// ---------------------------------------------------------------------------
// The fifth source
// ---------------------------------------------------------------------------

const cleanFetch = () =>
  stub({
    shifts: [workingDay('2026-03-02'), workingDay('2026-03-03')],
    blocked: [],
    timeOff: [],
  });

const roomsFull =
  (allDay: boolean): ResourceReader =>
  async () => ({
    status: 'checked',
    categories: [{ categoryId: 'cat-room', name: 'Treatment rooms' }],
    blockers: [
      {
        kind: 'no_free_resource',
        dates: ['2026-03-03'],
        categoryId: 'cat-room',
        categoryName: 'Treatment rooms',
        categoryNoun: 'room',
        windows: allDay ? [] : [{ from: '14:00', to: '15:00' }],
        allDay,
        contention: [
          { resourceId: 'r2', name: 'Room 2', busy: [], closed: allDay },
          { resourceId: 'r3', name: 'Room 3', busy: [], closed: allDay },
        ],
      },
    ],
  });

describe('availability port — rooms and equipment', () => {
  it('an unreadable RESOURCE check makes the result `partially_read`, naming it', async () => {
    // THE reason this source had to exist as a member rather than as extra
    // detail. Four clean reads plus an unreachable room check is not "nothing
    // is blocking this slot" — and there must be no shape in which it can be
    // reported as one.
    const port = createAvailabilityPort({
      apiFetch: cleanFetch(),
      readResources: async () => ({ status: 'unread', fault: 'db down' }),
    });

    const result = await port.explainAvailability({
      ...WINDOW,
      locationId: 'loc-1',
      serviceId: 'svc-1',
    });

    expect(result.status).toBe('partially_read');
    if (result.status !== 'partially_read') return;
    expect(result.unread).toEqual(['resources']);
    // Null and "named in unread" are the same fact; there is no third state a
    // consumer could mistake for a clean check.
    expect(result.resources).toBeNull();
  });

  it('omitting the reader entirely is UNREAD, never assumed clear', async () => {
    // A source cannot be talked into a clean verdict by leaving it unwired.
    const port = createAvailabilityPort({ apiFetch: cleanFetch() });

    const result = await port.explainAvailability({
      ...WINDOW,
      locationId: 'loc-1',
    });

    expect(result.status).toBe('partially_read');
    if (result.status !== 'partially_read') return;
    expect(result.unread).toContain('resources');
  });

  it('an org with no resource requirements gets a COMPLETE read, resources not implicated', async () => {
    // Backward compatibility, and the mirror-image mistake to the one above:
    // "this service needs nothing" is an answer, not a gap. Treating it as a
    // gap would deny every clinic that has never set a room up the complete
    // diagnosis they had before resources existed.
    const port = createAvailabilityPort({
      apiFetch: cleanFetch(),
      readResources: notApplicable,
    });

    const result = await port.explainAvailability({
      ...WINDOW,
      locationId: 'loc-1',
      serviceId: 'svc-1',
    });

    expect(result.status).toBe('read');
    if (result.status !== 'read') return;
    expect(result.resources).toEqual({ kind: 'not_applicable' });
    expect(result.blockers).toEqual([]);
    expect(result.bookableDates).toEqual(['2026-03-02', '2026-03-03']);
  });

  it('rooms free ⇒ checked, and not named as a blocker', async () => {
    const port = createAvailabilityPort({
      apiFetch: cleanFetch(),
      readResources: async () => ({
        status: 'checked',
        categories: [{ categoryId: 'cat-room', name: 'Treatment rooms' }],
        blockers: [],
      }),
    });

    const result = await port.explainAvailability({
      ...WINDOW,
      locationId: 'loc-1',
      serviceId: 'svc-1',
    });

    expect(result.status).toBe('read');
    if (result.status !== 'read') return;
    expect(result.resources).toEqual({
      kind: 'checked',
      categories: [{ categoryId: 'cat-room', name: 'Treatment rooms' }],
    });
    expect(result.blockers).toEqual([]);
  });

  it('rooms full for PART of a day blocks the slot without writing off the day', async () => {
    // The bug this shape exists to prevent: two rooms taken 14:00-15:00 leave
    // six other bookable hours, and reporting the date as unbookable is a
    // bigger outage than the one that exists.
    const port = createAvailabilityPort({
      apiFetch: cleanFetch(),
      readResources: roomsFull(false),
    });

    const result = await port.explainAvailability({
      ...WINDOW,
      locationId: 'loc-1',
      serviceId: 'svc-1',
    });

    expect(result.status).toBe('read');
    if (result.status !== 'read') return;
    const blocker = result.blockers.find((b) => b.kind === 'no_free_resource');
    expect(blocker).toBeDefined();
    expect(result.bookableDates).toEqual(['2026-03-02', '2026-03-03']);
  });

  it('a category that can serve NO open minute removes the date', async () => {
    const port = createAvailabilityPort({
      apiFetch: cleanFetch(),
      readResources: roomsFull(true),
    });

    const result = await port.explainAvailability({
      ...WINDOW,
      locationId: 'loc-1',
      serviceId: 'svc-1',
    });

    if (result.status === 'blocked') throw new Error('expected a read');
    expect(result.bookableDates).toEqual(['2026-03-02']);
  });

  it('echoes the serviceId the resource check was run for', async () => {
    const port = createAvailabilityPort({
      apiFetch: cleanFetch(),
      readResources: notApplicable,
    });
    const result = await port.explainAvailability({
      ...WINDOW,
      locationId: 'loc-1',
      serviceId: 'svc-9',
    });
    if (result.status === 'blocked') throw new Error('expected a read');
    expect(result.window.serviceId).toBe('svc-9');
  });

  it('when every source fails, five failures — not four — mean nothing was learned', async () => {
    const port = createAvailabilityPort({
      apiFetch: stub({}, ['shifts', 'blocked', 'timeOff', 'hours']),
      readResources: async () => ({ status: 'unread', fault: 'db down' }),
    });

    const result = await port.explainAvailability({
      ...WINDOW,
      locationId: 'loc-1',
      serviceId: 'svc-1',
    });

    expect(result.status).toBe('blocked');
  });
});
