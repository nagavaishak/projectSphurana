import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import {
  type ResourceGateContext,
  type ResourceRequirementSpec,
  filterSlotsByResources,
  hasFreeResourcesFor,
  loadResourceGateContext,
  pickResourcesFor,
} from './filter-slots-by-resources.js';
import type {
  ResolvedResourceAvailability,
  ResourceBusyRange,
} from './resolve-resource-availability.service.js';

// 2026-07-06 is a Monday; all times UTC for readability.
const at = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 6, 6, hour, minute));
const dayStart = at(0);
const dayEnd = at(23, 59);

function availability(
  resourceId: string,
  opts: {
    capacity?: number;
    working?: ResourceBusyRange[];
    busy?: ResourceBusyRange[];
  } = {}
): ResolvedResourceAvailability {
  return {
    resourceId,
    capacity: opts.capacity ?? 1,
    // Default: always open, the working_hours-null case.
    working: opts.working ?? [{ start: dayStart, end: dayEnd }],
    busy: opts.busy ?? [],
  };
}

function context(opts: {
  resourcesByCategory: Record<string, string[]>;
  availability: ResolvedResourceAvailability[];
  requirements: ResourceRequirementSpec[];
  turnaroundMinutes?: number;
}): ResourceGateContext {
  return {
    resourcesByCategory: new Map(Object.entries(opts.resourcesByCategory)),
    availabilityByResource: new Map(
      opts.availability.map((entry) => [entry.resourceId, entry])
    ),
    requirements: opts.requirements,
    turnaroundMinutes: opts.turnaroundMinutes ?? 0,
  };
}

/** "Needs one Room", open to every room in the category. */
const anyRoom: ResourceRequirementSpec = {
  serviceId: 'svc_1',
  categoryId: 'cat_rooms',
  eligibleResourceIds: [],
};

describe('hasFreeResourcesFor', () => {
  it('treats ZERO eligibility rows as "every room in the category qualifies"', () => {
    // THE critical case. Inverting it (zero rows = nothing qualifies) makes
    // every gated slot unbookable for every org that never restricted a
    // service to specific rooms — i.e. almost all of them.
    const ctx = context({
      resourcesByCategory: { cat_rooms: ['res_a', 'res_b'] },
      availability: [availability('res_a'), availability('res_b')],
      requirements: [anyRoom],
    });

    expect(hasFreeResourcesFor(ctx, at(10), at(11))).toBe(true);
  });

  it('falls through to another room in the category when the first is taken', () => {
    const ctx = context({
      resourcesByCategory: { cat_rooms: ['res_a', 'res_b'] },
      availability: [
        availability('res_a', { busy: [{ start: at(10), end: at(11) }] }),
        availability('res_b'),
      ],
      requirements: [anyRoom],
    });

    expect(hasFreeResourcesFor(ctx, at(10), at(11))).toBe(true);
  });

  it('drops the slot when every room in the category is taken', () => {
    const ctx = context({
      resourcesByCategory: { cat_rooms: ['res_a', 'res_b'] },
      availability: [
        availability('res_a', { busy: [{ start: at(10), end: at(11) }] }),
        availability('res_b', { busy: [{ start: at(9), end: at(12) }] }),
      ],
      requirements: [anyRoom],
    });

    expect(hasFreeResourcesFor(ctx, at(10), at(11))).toBe(false);
  });

  it('honours eligibility rows when present — a free INELIGIBLE room does not count', () => {
    const ctx = context({
      resourcesByCategory: { cat_rooms: ['res_a', 'res_b'] },
      availability: [
        availability('res_a'), // free, but not eligible
        availability('res_b', { busy: [{ start: at(10), end: at(11) }] }),
      ],
      requirements: [
        {
          serviceId: 'svc_1',
          categoryId: 'cat_rooms',
          eligibleResourceIds: ['res_b'],
        },
      ],
    });

    expect(hasFreeResourcesFor(ctx, at(10), at(11))).toBe(false);
  });

  it('requires a free resource in EVERY required category', () => {
    const ctx = context({
      resourcesByCategory: { cat_rooms: ['res_a'], cat_lasers: ['laser_1'] },
      availability: [
        availability('res_a'),
        availability('laser_1', { busy: [{ start: at(10), end: at(11) }] }),
      ],
      requirements: [
        anyRoom,
        {
          serviceId: 'svc_1',
          categoryId: 'cat_lasers',
          eligibleResourceIds: [],
        },
      ],
    });

    expect(hasFreeResourcesFor(ctx, at(10), at(11))).toBe(false);
  });

  it('intersects eligibility when two cart services share one category hold', () => {
    // v1 books one hold per category spanning the cart, so the single room must
    // satisfy both services: only res_b is named by both.
    const ctx = context({
      resourcesByCategory: { cat_rooms: ['res_a', 'res_b', 'res_c'] },
      availability: [
        availability('res_a'),
        availability('res_b', { busy: [{ start: at(9), end: at(12) }] }),
        availability('res_c'),
      ],
      requirements: [
        {
          serviceId: 'svc_1',
          categoryId: 'cat_rooms',
          eligibleResourceIds: ['res_a', 'res_b'],
        },
        {
          serviceId: 'svc_2',
          categoryId: 'cat_rooms',
          eligibleResourceIds: ['res_b', 'res_c'],
        },
      ],
    });

    expect(hasFreeResourcesFor(ctx, at(10), at(11))).toBe(false);
  });

  it('capacity 1: a single overlapping allocation makes the room busy', () => {
    const ctx = context({
      resourcesByCategory: { cat_rooms: ['res_a'] },
      availability: [
        availability('res_a', {
          capacity: 1,
          busy: [{ start: at(10), end: at(11) }],
        }),
      ],
      requirements: [anyRoom],
    });

    expect(hasFreeResourcesFor(ctx, at(10), at(11))).toBe(false);
  });

  it('capacity 2: one allocation still leaves the room free, two do not', () => {
    const one = context({
      resourcesByCategory: { cat_rooms: ['res_a'] },
      availability: [
        availability('res_a', {
          capacity: 2,
          busy: [{ start: at(10), end: at(11) }],
        }),
      ],
      requirements: [anyRoom],
    });
    expect(hasFreeResourcesFor(one, at(10), at(11))).toBe(true);

    const two = context({
      resourcesByCategory: { cat_rooms: ['res_a'] },
      availability: [
        availability('res_a', {
          capacity: 2,
          busy: [
            { start: at(10), end: at(11) },
            { start: at(10, 30), end: at(11, 30) },
          ],
        }),
      ],
      requirements: [anyRoom],
    });
    expect(hasFreeResourcesFor(two, at(10), at(11))).toBe(false);
  });

  it('does not collide back-to-back allocations (overlap is half-open)', () => {
    const ctx = context({
      resourcesByCategory: { cat_rooms: ['res_a'] },
      availability: [
        availability('res_a', { busy: [{ start: at(11), end: at(12) }] }),
      ],
      requirements: [anyRoom],
    });

    expect(hasFreeResourcesFor(ctx, at(10), at(11))).toBe(true);
  });

  it('turnaround extends the HOLD: a slot that fits without cleanup is rejected with it', () => {
    const busy = [{ start: at(11), end: at(12) }];
    const withoutTurnaround = context({
      resourcesByCategory: { cat_rooms: ['res_a'] },
      availability: [availability('res_a', { busy })],
      requirements: [anyRoom],
      turnaroundMinutes: 0,
    });
    expect(hasFreeResourcesFor(withoutTurnaround, at(10), at(11))).toBe(true);

    const withTurnaround = context({
      resourcesByCategory: { cat_rooms: ['res_a'] },
      availability: [availability('res_a', { busy })],
      requirements: [anyRoom],
      turnaroundMinutes: 15,
    });
    // Hold now runs 10:00–11:15 and collides with the 11:00 allocation.
    expect(hasFreeResourcesFor(withTurnaround, at(10), at(11))).toBe(false);
  });

  it('requires the whole hold — cleanup included — to fit inside working hours', () => {
    const working = [{ start: at(9), end: at(17) }];
    const ctx = context({
      resourcesByCategory: { cat_rooms: ['res_a'] },
      availability: [availability('res_a', { working })],
      requirements: [anyRoom],
      turnaroundMinutes: 15,
    });

    // 16:00–17:00 + 15 minutes of cleanup runs past the 17:00 close.
    expect(hasFreeResourcesFor(ctx, at(16), at(17))).toBe(false);
    expect(hasFreeResourcesFor(ctx, at(15), at(16))).toBe(true);
  });

  it('never spans two working intervals (a lunch-split day)', () => {
    const ctx = context({
      resourcesByCategory: { cat_rooms: ['res_a'] },
      availability: [
        availability('res_a', {
          working: [
            { start: at(9), end: at(13) },
            { start: at(14), end: at(17) },
          ],
        }),
      ],
      requirements: [anyRoom],
    });

    expect(hasFreeResourcesFor(ctx, at(12, 30), at(14, 30))).toBe(false);
    expect(hasFreeResourcesFor(ctx, at(14), at(15))).toBe(true);
  });

  it('treats a resource with no availability entry as not bookable', () => {
    // Deactivated or soft-deleted between the requirement being written and now.
    const ctx = context({
      resourcesByCategory: { cat_rooms: ['res_gone'] },
      availability: [],
      requirements: [anyRoom],
    });

    expect(hasFreeResourcesFor(ctx, at(10), at(11))).toBe(false);
  });

  it('is a no-op when the cart has no requirements at all', () => {
    const ctx = context({
      resourcesByCategory: {},
      availability: [],
      requirements: [],
    });

    expect(hasFreeResourcesFor(ctx, at(10), at(11))).toBe(true);
  });
});

describe('filterSlotsByResources', () => {
  const slots = [
    { start: at(9), end: at(10) },
    { start: at(10), end: at(11) },
    { start: at(11), end: at(12) },
  ];

  it('drops only the slots no eligible room can serve', () => {
    const ctx = context({
      resourcesByCategory: { cat_rooms: ['res_a'] },
      availability: [
        availability('res_a', { busy: [{ start: at(10), end: at(11) }] }),
      ],
      requirements: [anyRoom],
    });

    expect(filterSlotsByResources(slots, ctx)).toEqual([
      { start: at(9), end: at(10) },
      { start: at(11), end: at(12) },
    ]);
  });

  it('returns the slots untouched when nothing in the cart needs a resource', () => {
    const ctx = context({
      resourcesByCategory: {},
      availability: [],
      requirements: [],
    });

    expect(filterSlotsByResources(slots, ctx)).toBe(slots);
  });

  it('preserves the caller slot shape (extra fields survive)', () => {
    const richSlots = [
      { start: at(9), end: at(10), practitionerId: 'prac_1' },
      { start: at(10), end: at(11), practitionerId: 'prac_2' },
    ];
    const ctx = context({
      resourcesByCategory: { cat_rooms: ['res_a'] },
      availability: [
        availability('res_a', { busy: [{ start: at(10), end: at(11) }] }),
      ],
      requirements: [anyRoom],
    });

    expect(filterSlotsByResources(richSlots, ctx)).toEqual([
      { start: at(9), end: at(10), practitionerId: 'prac_1' },
    ]);
  });
});

describe('pickResourcesFor', () => {
  it('spreads wear: prefers the least-allocated room that calendar day', () => {
    const ctx = context({
      resourcesByCategory: { cat_rooms: ['res_a', 'res_b'] },
      availability: [
        // res_a comes first in category order but already worked twice today.
        availability('res_a', {
          busy: [
            { start: at(8), end: at(9) },
            { start: at(12), end: at(13) },
          ],
        }),
        availability('res_b'),
      ],
      requirements: [anyRoom],
    });

    expect(pickResourcesFor(ctx, at(10), at(11))).toEqual([
      { categoryId: 'cat_rooms', resourceId: 'res_b', turnaroundMinutes: 0 },
    ]);
  });

  it('breaks ties on resourcesByCategory order', () => {
    const ctx = context({
      resourcesByCategory: { cat_rooms: ['res_a', 'res_b'] },
      availability: [availability('res_a'), availability('res_b')],
      requirements: [anyRoom],
    });

    expect(pickResourcesFor(ctx, at(10), at(11))?.[0].resourceId).toBe('res_a');
  });

  it('returns null when a required category is fully booked', () => {
    const ctx = context({
      resourcesByCategory: { cat_rooms: ['res_a'], cat_lasers: ['laser_1'] },
      availability: [
        availability('res_a'),
        availability('laser_1', { busy: [{ start: at(9), end: at(12) }] }),
      ],
      requirements: [
        anyRoom,
        {
          serviceId: 'svc_1',
          categoryId: 'cat_lasers',
          eligibleResourceIds: [],
        },
      ],
    });

    expect(pickResourcesFor(ctx, at(10), at(11))).toBeNull();
  });

  it('picks one resource per required category and stamps the cart turnaround', () => {
    const ctx = context({
      resourcesByCategory: { cat_rooms: ['res_a'], cat_lasers: ['laser_1'] },
      availability: [availability('res_a'), availability('laser_1')],
      requirements: [
        anyRoom,
        {
          serviceId: 'svc_2',
          categoryId: 'cat_lasers',
          eligibleResourceIds: [],
        },
      ],
      turnaroundMinutes: 20,
    });

    expect(pickResourcesFor(ctx, at(10), at(11))).toEqual([
      { categoryId: 'cat_rooms', resourceId: 'res_a', turnaroundMinutes: 20 },
      {
        categoryId: 'cat_lasers',
        resourceId: 'laser_1',
        turnaroundMinutes: 20,
      },
    ]);
  });

  it('ignores allocations on other days when spreading', () => {
    const yesterday = (hour: number) => new Date(Date.UTC(2026, 6, 5, hour));
    const ctx = context({
      resourcesByCategory: { cat_rooms: ['res_a', 'res_b'] },
      availability: [
        // Busy all day yesterday — irrelevant to today's spread.
        availability('res_a', {
          busy: [
            { start: yesterday(8), end: yesterday(9) },
            { start: yesterday(12), end: yesterday(13) },
          ],
        }),
        availability('res_b'),
      ],
      requirements: [anyRoom],
    });

    expect(pickResourcesFor(ctx, at(10), at(11))?.[0].resourceId).toBe('res_a');
  });
});

describe('loadResourceGateContext', () => {
  const mockDb = createMockDatabase();

  const baseInput = {
    organizationId: 'org_1',
    serviceIds: ['svc_1'],
    from: dayStart,
    to: dayEnd,
    timeZone: 'UTC',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockDb.where.mockReset();
    mockDb.where.mockReturnThis();
  });

  /**
   * Queue the sequential .where() results: requirements, eligibility,
   * categories, resources, services, then resolveResourceAvailability's own
   * two (resources again, allocations).
   */
  function queueWheres(opts: {
    requirements?: unknown[];
    eligibility?: unknown[];
    categories?: unknown[];
    resources?: unknown[];
    services?: unknown[];
    availabilityResources?: unknown[];
    allocations?: unknown[];
  }) {
    mockDb.where
      .mockResolvedValueOnce(opts.requirements ?? [])
      .mockResolvedValueOnce(opts.eligibility ?? [])
      .mockResolvedValueOnce(opts.categories ?? [])
      .mockResolvedValueOnce(opts.resources ?? [])
      .mockResolvedValueOnce(opts.services ?? [])
      .mockResolvedValueOnce(opts.availabilityResources ?? [])
      .mockResolvedValueOnce(opts.allocations ?? []);
  }

  it('returns null when no service in the cart has ANY requirement (rollout safety)', async () => {
    queueWheres({ requirements: [] });

    const ctx = await loadResourceGateContext(mockDb as never, baseInput);

    expect(ctx).toBeNull();
    // Cheap: one lookup that finds nothing, then the booking path is untouched.
    expect(mockDb.where).toHaveBeenCalledTimes(1);
  });

  it('returns null for an empty cart without querying at all', async () => {
    const ctx = await loadResourceGateContext(mockDb as never, {
      ...baseInput,
      serviceIds: [],
    });

    expect(ctx).toBeNull();
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('never gates on a category the service does not require', async () => {
    // AUTO-ASSIGN IS REQUIRED-ONLY.
    //
    // A clinic can have Laser Suites, Spa equipment and Spa Suites set up
    // while a given service requires none of them. Those categories are
    // OPTIONAL: the front desk may record one by hand, but the allocator must
    // never pick one on its own — an appointment silently holding a laser it
    // does not need takes that laser off every other booking's availability.
    //
    // Two things enforce it, and this pins both ends. The category read is
    // `inArray(resourceCategory.id, requiredCategoryIds)` and the resource
    // read is scoped to the categories that survived it, so an unrequired
    // category cannot enter the context; and `pickResourcesFor` fills from
    // `requirements`, so it cannot fill one that did not.
    queueWheres({
      requirements: [{ serviceId: 'svc_1', categoryId: 'cat_rooms' }],
      eligibility: [],
      // `cat_lasers` is deliberately ABSENT from both reads — that is what the
      // required-only scoping produces, and modelling it any other way would
      // assert against the mock rather than the code.
      categories: [{ id: 'cat_rooms' }],
      resources: [{ id: 'res_room', categoryId: 'cat_rooms', sortOrder: 0 }],
      services: [{ id: 'svc_1', turnaroundMinutes: 0 }],
      availabilityResources: [
        { id: 'res_room', capacity: 1, workingHours: null },
      ],
    });

    const ctx = await loadResourceGateContext(mockDb as never, baseInput);

    expect(ctx).not.toBeNull();
    expect(ctx?.requirements).toEqual([
      { serviceId: 'svc_1', categoryId: 'cat_rooms', eligibleResourceIds: [] },
    ]);
    expect([...(ctx?.resourcesByCategory.keys() ?? [])]).toEqual(['cat_rooms']);

    // And what the allocator would actually hold: the room, and nothing else.
    const picks = pickResourcesFor(
      ctx as never,
      new Date(dayStart.getTime() + 10 * 60 * 60_000),
      new Date(dayStart.getTime() + 11 * 60 * 60_000)
    );
    expect(picks?.map((pick) => pick.categoryId)).toEqual(['cat_rooms']);
  });

  it('builds a context with all category resources when no eligibility rows exist', async () => {
    queueWheres({
      requirements: [{ serviceId: 'svc_1', categoryId: 'cat_rooms' }],
      eligibility: [],
      categories: [{ id: 'cat_rooms' }],
      resources: [
        { id: 'res_b', categoryId: 'cat_rooms', sortOrder: 0 },
        { id: 'res_a', categoryId: 'cat_rooms', sortOrder: 0 },
      ],
      services: [{ id: 'svc_1', turnaroundMinutes: 15 }],
      availabilityResources: [
        { id: 'res_a', capacity: 1, workingHours: null },
        { id: 'res_b', capacity: 1, workingHours: null },
      ],
    });

    const ctx = await loadResourceGateContext(mockDb as never, baseInput);

    expect(ctx).not.toBeNull();
    // Equal sort_order ⇒ the stable id tie-break decides.
    expect(ctx?.resourcesByCategory.get('cat_rooms')).toEqual([
      'res_a',
      'res_b',
    ]);
    expect(ctx?.requirements).toEqual([
      { serviceId: 'svc_1', categoryId: 'cat_rooms', eligibleResourceIds: [] },
    ]);
    expect(ctx?.turnaroundMinutes).toBe(15);
    expect(ctx?.availabilityByResource.size).toBe(2);
  });

  it('attaches eligibility rows to the requirement whose category they belong to', async () => {
    queueWheres({
      requirements: [
        { serviceId: 'svc_1', categoryId: 'cat_rooms' },
        { serviceId: 'svc_1', categoryId: 'cat_lasers' },
      ],
      eligibility: [
        { serviceId: 'svc_1', resourceId: 'laser_1' },
        { serviceId: 'svc_1', resourceId: 'res_a' },
      ],
      categories: [{ id: 'cat_rooms' }, { id: 'cat_lasers' }],
      resources: [
        { id: 'res_a', categoryId: 'cat_rooms', sortOrder: 0 },
        { id: 'laser_1', categoryId: 'cat_lasers', sortOrder: 0 },
      ],
      services: [{ id: 'svc_1', turnaroundMinutes: null }],
      availabilityResources: [
        { id: 'res_a', capacity: 1, workingHours: null },
        { id: 'laser_1', capacity: 1, workingHours: null },
      ],
    });

    const ctx = await loadResourceGateContext(mockDb as never, baseInput);

    expect(ctx?.requirements).toEqual([
      {
        serviceId: 'svc_1',
        categoryId: 'cat_rooms',
        eligibleResourceIds: ['res_a'],
      },
      {
        serviceId: 'svc_1',
        categoryId: 'cat_lasers',
        eligibleResourceIds: ['laser_1'],
      },
    ]);
    expect(ctx?.turnaroundMinutes).toBe(0);
  });

  it('drops requirements pointing at a soft-deleted category instead of blocking the service', async () => {
    queueWheres({
      requirements: [{ serviceId: 'svc_1', categoryId: 'cat_gone' }],
      categories: [], // filtered out by isActive / deletedAt
    });

    const ctx = await loadResourceGateContext(mockDb as never, baseInput);

    expect(ctx).toBeNull();
  });

  it('orders resources by sortOrder then id, so equal-load ties pick the clinic first choice', async () => {
    // Two rooms, one allocation each today = equal load, so the ONLY thing
    // separating them is the clinic's own ordering. Queued twice with the DB
    // rows in opposite orders to prove the pick is the clinic's sort_order and
    // not whatever order the rows happened to arrive in.
    const rows = [
      { id: 'res_a', categoryId: 'cat_rooms', sortOrder: 5 },
      { id: 'res_b', categoryId: 'cat_rooms', sortOrder: 1 },
    ];
    const fixture = {
      requirements: [{ serviceId: 'svc_1', categoryId: 'cat_rooms' }],
      categories: [{ id: 'cat_rooms' }],
      services: [{ id: 'svc_1', turnaroundMinutes: null }],
      availabilityResources: [
        { id: 'res_a', capacity: 1, workingHours: null },
        { id: 'res_b', capacity: 1, workingHours: null },
      ],
      allocations: [
        { resourceId: 'res_a', startDate: at(8), endDate: at(9) },
        { resourceId: 'res_b', startDate: at(8), endDate: at(9) },
      ],
    };
    queueWheres({ ...fixture, resources: rows });
    queueWheres({ ...fixture, resources: [...rows].reverse() });

    for (const _ of [0, 1]) {
      const ctx = await loadResourceGateContext(mockDb as never, baseInput);

      // sortOrder 1 sorts ahead of sortOrder 5 regardless of row order.
      expect(ctx?.resourcesByCategory.get('cat_rooms')).toEqual([
        'res_b',
        'res_a',
      ]);
      expect(pickResourcesFor(ctx as never, at(10), at(11))).toEqual([
        { categoryId: 'cat_rooms', resourceId: 'res_b', turnaroundMinutes: 0 },
      ]);
    }
  });

  it('takes the MAX turnaround across the cart services', async () => {
    queueWheres({
      requirements: [{ serviceId: 'svc_1', categoryId: 'cat_rooms' }],
      categories: [{ id: 'cat_rooms' }],
      resources: [{ id: 'res_a', categoryId: 'cat_rooms', sortOrder: 0 }],
      services: [
        { id: 'svc_1', turnaroundMinutes: 10 },
        { id: 'svc_2', turnaroundMinutes: 25 },
      ],
      availabilityResources: [{ id: 'res_a', capacity: 1, workingHours: null }],
    });

    const ctx = await loadResourceGateContext(mockDb as never, {
      ...baseInput,
      serviceIds: ['svc_1', 'svc_2'],
    });

    expect(ctx?.turnaroundMinutes).toBe(25);
    // The availability window is padded by the tail so the last slot of the
    // window can still fit its cleanup.
    expect(ctx?.availabilityByResource.get('res_a')?.working[0].end).toEqual(
      new Date(dayEnd.getTime() + 25 * 60_000)
    );
  });
});
