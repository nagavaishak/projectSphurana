import { createResourceAvailabilityReader } from './resource-availability.reader.js';

/**
 * The reader turns booking-engine state into an EXPLANATION, so these tests are
 * about the two things that state alone cannot get wrong on its own:
 *
 *  1. "no requirements" vs "could not check". Same absence of a blocker, wildly
 *     different meaning — one is a complete answer for every clinic that has
 *     never configured a room, the other is the lie the port exists to prevent.
 *  2. WHICH room, and WHAT is holding it. "No slots" sends an owner hunting;
 *     "Room 2 and Room 3 are both booked 14:00-15:00" points at the two
 *     appointments they can actually move.
 */

const TZ = 'Europe/Dublin';

// 2026-03-03 is in Irish winter time, so local == UTC. Kept deliberately: a
// summer date would make every expected wall-clock string a puzzle, and the
// zone conversion itself is covered by `zonedWallTimeToUtc`'s own tests.
const at = (hhmm: string) => new Date(`2026-03-03T${hhmm}:00.000Z`);

const gateContext = jest.fn();

jest.mock('@borradh-workspace/features/scheduling', () => ({
  loadResourceGateContext: (...args: unknown[]) => gateContext(...args),
}));
jest.mock('@borradh-workspace/database', () => ({ db: {} }));

/**
 * A db that answers the three flat reads: does this org gate anything on a
 * room, what are the categories called, and what are the rooms called.
 */
function db(hasRequirements: boolean) {
  return {
    query: {
      serviceResourceRequirement: {
        findFirst: async () =>
          hasRequirements ? { serviceId: 'svc-1' } : undefined,
      },
      resourceCategory: {
        findMany: async () => [
          { id: 'cat-room', name: 'Treatment rooms', kind: 'room' },
        ],
      },
      resource: {
        findMany: async () => [
          { id: 'r2', name: 'Room 2' },
          { id: 'r3', name: 'Room 3' },
        ],
      },
    },
  } as never;
}

const OPEN_ALL_DAY = [{ start: at('08:00'), end: at('18:00') }];

function reader(hasRequirements = true) {
  return createResourceAvailabilityReader({
    organizationId: 'org-1',
    timeZone: TZ,
    db: db(hasRequirements),
  });
}

const REQUEST = {
  from: '2026-03-03',
  to: '2026-03-03',
  dates: ['2026-03-03'],
  serviceId: 'svc-1',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('resource availability reader — not applicable vs unread', () => {
  it('an org that gates nothing on a resource is NOT_APPLICABLE, not unread', async () => {
    // The whole rollout-safety story. Every clinic today is this org, and
    // reporting it as unread would take away the complete answer they already
    // had — a phantom room problem for a business with no rooms.
    const result = await reader(false)(REQUEST);
    expect(result.status).toBe('not_applicable');
    expect(gateContext).not.toHaveBeenCalled();
  });

  it('a service that needs nothing is NOT_APPLICABLE even where the org gates others', async () => {
    gateContext.mockResolvedValue(null);
    const result = await reader()(REQUEST);
    expect(result.status).toBe('not_applicable');
  });

  it('no serviceId, in an org that DOES gate, is UNREAD — not a clean bill', async () => {
    // What a booking needs is a property of the service, not the date. Without
    // one we genuinely did not check, and must say so.
    const result = await reader()({ ...REQUEST, serviceId: undefined });
    expect(result.status).toBe('unread');
    if (result.status !== 'unread') return;
    // No fault: this is a caller-shaped gap, not a server breaking, so it must
    // not page anyone.
    expect(result.fault).toBeUndefined();
  });

  it('a thrown read is UNREAD and carries the fault', async () => {
    gateContext.mockRejectedValue(new Error('connection reset'));
    const result = await reader()(REQUEST);
    expect(result.status).toBe('unread');
    if (result.status !== 'unread') return;
    expect(result.fault).toBe('connection reset');
  });
});

describe('resource availability reader — diagnosis', () => {
  const twoRooms = (
    busyR2: { start: Date; end: Date }[],
    busyR3: { start: Date; end: Date }[]
  ) => ({
    resourcesByCategory: new Map([['cat-room', ['r2', 'r3']]]),
    availabilityByResource: new Map([
      [
        'r2',
        { resourceId: 'r2', capacity: 1, working: OPEN_ALL_DAY, busy: busyR2 },
      ],
      [
        'r3',
        { resourceId: 'r3', capacity: 1, working: OPEN_ALL_DAY, busy: busyR3 },
      ],
    ]),
    requirements: [
      { serviceId: 'svc-1', categoryId: 'cat-room', eligibleResourceIds: [] },
    ],
    turnaroundMinutes: 0,
  });

  it('rooms free ⇒ checked with NO blocker', async () => {
    gateContext.mockResolvedValue(
      twoRooms([{ start: at('09:00'), end: at('10:00') }], [])
    );
    const result = await reader()(REQUEST);
    expect(result.status).toBe('checked');
    if (result.status !== 'checked') return;
    expect(result.blockers).toEqual([]);
    expect(result.categories).toEqual([
      { categoryId: 'cat-room', name: 'Treatment rooms' },
    ]);
  });

  it('every eligible room booked ⇒ names the rooms, the window and the category', async () => {
    gateContext.mockResolvedValue(
      twoRooms(
        [{ start: at('14:00'), end: at('15:00') }],
        [{ start: at('14:00'), end: at('15:00') }]
      )
    );

    const result = await reader()(REQUEST);
    if (result.status !== 'checked') throw new Error('expected a checked read');
    expect(result.blockers).toHaveLength(1);

    const blocker = result.blockers[0];
    if (blocker.kind !== 'no_free_resource') throw new Error('wrong kind');
    expect(blocker.dates).toEqual(['2026-03-03']);
    expect(blocker.categoryName).toBe('Treatment rooms');
    expect(blocker.categoryNoun).toBe('room');
    expect(blocker.windows).toEqual([{ from: '14:00', to: '15:00' }]);
    // The rest of the day is bookable, so this must NOT write the date off.
    expect(blocker.allDay).toBe(false);
    expect(blocker.contention.map((c) => c.name)).toEqual(['Room 2', 'Room 3']);
    expect(blocker.contention[0].busy).toEqual([
      { from: '14:00', to: '15:00' },
    ]);
    expect(blocker.contention[0].closed).toBe(false);
  });

  it('one room free is enough — a partly-booked category is not a blocker', async () => {
    // The most valuable negative: over-reporting here would have Claire tell an
    // owner to move an appointment that was never in the way.
    gateContext.mockResolvedValue(
      twoRooms([{ start: at('14:00'), end: at('15:00') }], [])
    );
    const result = await reader()(REQUEST);
    if (result.status !== 'checked') throw new Error('expected a checked read');
    expect(result.blockers).toEqual([]);
  });

  it('capacity is respected — a double room takes two before it is full', async () => {
    gateContext.mockResolvedValue({
      resourcesByCategory: new Map([['cat-room', ['r2']]]),
      availabilityByResource: new Map([
        [
          'r2',
          {
            resourceId: 'r2',
            capacity: 2,
            working: OPEN_ALL_DAY,
            busy: [{ start: at('14:00'), end: at('15:00') }],
          },
        ],
      ]),
      requirements: [
        { serviceId: 'svc-1', categoryId: 'cat-room', eligibleResourceIds: [] },
      ],
      turnaroundMinutes: 0,
    });
    const result = await reader()(REQUEST);
    if (result.status !== 'checked') throw new Error('expected a checked read');
    expect(result.blockers).toEqual([]);
  });

  it('a category whose rooms are all SHUT is all-day and flagged closed, not booked', async () => {
    // A settings problem, not a diary one, and the two have different fixes.
    gateContext.mockResolvedValue({
      ...twoRooms([], []),
      availabilityByResource: new Map([
        ['r2', { resourceId: 'r2', capacity: 1, working: [], busy: [] }],
        ['r3', { resourceId: 'r3', capacity: 1, working: [], busy: [] }],
      ]),
    });

    const result = await reader()(REQUEST);
    if (result.status !== 'checked') throw new Error('expected a checked read');
    const blocker = result.blockers[0];
    if (blocker?.kind !== 'no_free_resource') throw new Error('wrong kind');
    expect(blocker.allDay).toBe(true);
    expect(blocker.windows).toEqual([]);
    expect(blocker.contention.every((c) => c.closed)).toBe(true);
    expect(blocker.contention.flatMap((c) => c.busy)).toEqual([]);
  });

  it('a required category with nothing eligible in it is an all-day blocker', async () => {
    gateContext.mockResolvedValue({
      resourcesByCategory: new Map([['cat-room', []]]),
      availabilityByResource: new Map(),
      requirements: [
        { serviceId: 'svc-1', categoryId: 'cat-room', eligibleResourceIds: [] },
      ],
      turnaroundMinutes: 0,
    });
    const result = await reader()(REQUEST);
    if (result.status !== 'checked') throw new Error('expected a checked read');
    const blocker = result.blockers[0];
    if (blocker?.kind !== 'no_free_resource') throw new Error('wrong kind');
    expect(blocker.allDay).toBe(true);
    expect(blocker.contention).toEqual([]);
  });

  it('zero eligibility rows means ANY room qualifies, never none', async () => {
    // Inverting this is the single most destructive mistake available here: it
    // would report every gated service as roomless for every clinic that never
    // restricted one to specific rooms.
    gateContext.mockResolvedValue(twoRooms([], []));
    const result = await reader()(REQUEST);
    if (result.status !== 'checked') throw new Error('expected a checked read');
    expect(result.blockers).toEqual([]);
  });

  it('eligibility narrows the candidates — an ineligible free room does not rescue the slot', async () => {
    const ctx = twoRooms([{ start: at('14:00'), end: at('15:00') }], []);
    ctx.requirements = [
      {
        serviceId: 'svc-1',
        categoryId: 'cat-room',
        eligibleResourceIds: ['r2'],
      },
    ];
    gateContext.mockResolvedValue(ctx);

    const result = await reader()(REQUEST);
    if (result.status !== 'checked') throw new Error('expected a checked read');
    const blocker = result.blockers[0];
    if (blocker?.kind !== 'no_free_resource') throw new Error('wrong kind');
    // Room 3 is free but cannot do this service, so it is not named as an
    // option — naming it would send the owner to a room that never qualified.
    expect(blocker.contention.map((c) => c.name)).toEqual(['Room 2']);
  });
});
