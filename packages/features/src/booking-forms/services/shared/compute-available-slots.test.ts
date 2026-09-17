import {
  type MockInstance,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
// Keep the real generateSlots (pure) — stub only resolveAvailability, which is
// the DB-backed part.
//
// Spy the SOURCE module, not the resolve-availability barrel: the barrel's
// re-exports are live getters under Vite SSR and cannot be redefined. A
// restored spy also can't leak onto the shared module graph (`isolate: false`).
import * as resolveAvailabilityModule from '../../../scheduling/services/resolve-availability/resolve-availability.service.js';
// Same rule for the resource gate: keep the real `filterSlotsByResources`
// (pure, in-memory) and stub only `loadResourceGateContext`, which is the
// DB-backed half. Spying the SOURCE module, not the barrel, for the reason
// above.
import * as resourceGateModule from '../../../scheduling/services/resolve-resource-availability/filter-slots-by-resources.js';
import type { ResourceGateContext } from '../../../scheduling/services/resolve-resource-availability/index.js';
import { computePractitionerSlots } from './compute-available-slots.js';

const DAY = 24 * 60 * 60 * 1000;

const PRACTITIONER = {
  id: 'prac-1',
  name: 'Solo Owner',
  photo: null,
  title: null,
  // No calendar account → no Google free/busy call, so no DB read at all.
  calendarAccountId: null,
  workingHours: null,
  locationWorkingHours: null,
};

const mockDb = {} as never;

/** 09:00–18:00 UTC on the day `dayOffset` days from now. */
function workingDay(dayOffset: number) {
  const start = new Date(Date.now() + dayOffset * DAY);
  start.setUTCHours(9, 0, 0, 0);
  const end = new Date(start);
  end.setUTCHours(18, 0, 0, 0);
  return { start, end };
}

/**
 * A gate context with ONE category ("rooms") holding one always-open resource,
 * busy for the given ranges. Turnaround is 0 so the hold is exactly the slot —
 * the tail has its own coverage in the engine's tests.
 */
function roomContext(
  busy: { start: Date; end: Date }[] = [],
  options: { capacity?: number; window?: { start: Date; end: Date } } = {}
): ResourceGateContext {
  const window = options.window ?? {
    start: new Date(0),
    end: new Date(8.64e15),
  };
  return {
    resourcesByCategory: new Map([['cat-rooms', ['room-1']]]),
    availabilityByResource: new Map([
      [
        'room-1',
        {
          resourceId: 'room-1',
          capacity: options.capacity ?? 1,
          working: [window],
          busy,
        },
      ],
    ]),
    requirements: [
      { serviceId: 'svc-1', categoryId: 'cat-rooms', eligibleResourceIds: [] },
    ],
    turnaroundMinutes: 0,
  };
}

describe('computePractitionerSlots', () => {
  let resolveAvailability: MockInstance;
  let loadResourceGateContext: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    resolveAvailability = vi.spyOn(
      resolveAvailabilityModule,
      'resolveAvailability'
    );
    loadResourceGateContext = vi
      .spyOn(resourceGateModule, 'loadResourceGateContext')
      // Default: no service in the cart has a requirement — the state every
      // existing org is in.
      .mockResolvedValue(null);
  });

  afterEach(() => {
    resolveAvailability.mockRestore();
    loadResourceGateContext.mockRestore();
  });

  it('turns the resolved working intervals into slots', async () => {
    const day = workingDay(2);
    resolveAvailability.mockResolvedValue([
      { practitionerId: 'prac-1', working: [day], busy: [] },
    ]);

    const { merged, byPractitioner } = await computePractitionerSlots(
      mockDb,
      [PRACTITIONER],
      'org-1',
      null,
      'UTC',
      new Date(day.start.getTime() - DAY),
      new Date(day.end.getTime() + DAY),
      30,
      'test'
    );

    expect(merged.length).toBeGreaterThan(0);
    expect(byPractitioner).toHaveLength(1);
    for (const slot of merged) {
      expect(slot.startTime.getTime()).toBeGreaterThanOrEqual(
        day.start.getTime()
      );
      expect(slot.endTime.getTime()).toBeLessThanOrEqual(day.end.getTime());
    }
  });

  it('offers nothing for a practitioner with no working time (e.g. a day off)', async () => {
    // This is the whole reason the org-business-hours path was deleted: a day
    // the practitioner marked as not working resolves to zero working
    // intervals, and that must produce zero slots — not fall back to the
    // business's posted opening hours.
    resolveAvailability.mockResolvedValue([
      { practitionerId: 'prac-1', working: [], busy: [] },
    ]);

    const day = workingDay(2);
    const { merged } = await computePractitionerSlots(
      mockDb,
      [PRACTITIONER],
      'org-1',
      // Business hours say the org is open all week — deliberately ignored.
      Object.fromEntries(
        [0, 1, 2, 3, 4, 5, 6].map((d) => [d, { from: 540, to: 1080 }])
      ),
      'UTC',
      new Date(day.start.getTime() - DAY),
      new Date(day.end.getTime() + DAY),
      30,
      'test'
    );

    expect(merged).toEqual([]);
  });

  it('subtracts busy intervals from the working time', async () => {
    const day = workingDay(2);

    resolveAvailability.mockResolvedValueOnce([
      { practitionerId: 'prac-1', working: [day], busy: [] },
    ]);
    const before = await computePractitionerSlots(
      mockDb,
      [PRACTITIONER],
      'org-1',
      null,
      'UTC',
      day.start,
      day.end,
      30,
      'test'
    );

    resolveAvailability.mockResolvedValueOnce([
      { practitionerId: 'prac-1', working: [day], busy: [day] },
    ]);
    const after = await computePractitionerSlots(
      mockDb,
      [PRACTITIONER],
      'org-1',
      null,
      'UTC',
      day.start,
      day.end,
      30,
      'test'
    );

    expect(before.merged.length).toBeGreaterThan(0);
    expect(after.merged).toEqual([]);
  });
  // ---------------------------------------------------------------------------
  // Resource gate (treatment rooms / equipment).
  //
  // A clinic with three practitioners and two rooms can only run two treatments
  // at 14:00. These guard that the PUBLIC widget — the highest-stakes consumer,
  // and the one running as `app_public` — stops offering the third, WITHOUT
  // changing anything for the orgs (i.e. all of them today) that have never
  // configured a resource.
  // ---------------------------------------------------------------------------
  describe('resource gate', () => {
    const day = workingDay(2);

    async function compute(resourceGate?: {
      serviceIds: string[];
      locationId?: string | null;
    }) {
      resolveAvailability.mockResolvedValueOnce([
        { practitionerId: 'prac-1', working: [day], busy: [] },
      ]);
      return computePractitionerSlots(
        mockDb,
        [PRACTITIONER],
        'org-1',
        null,
        'UTC',
        day.start,
        day.end,
        30,
        'test',
        undefined,
        // locationId — the gate carries its own branch in these cases.
        undefined,
        resourceGate
      );
    }

    it('is byte-identical to the ungated result when no service has requirements', async () => {
      // THE rollout-safety guard. Every existing org is in this state: the
      // loader finds no requirement row and returns null, and the slot list
      // must be exactly what it was before resources existed.
      const ungated = await compute();
      const gated = await compute({ serviceIds: ['svc-1'] });

      expect(loadResourceGateContext).toHaveBeenCalledTimes(1);
      expect(gated.merged).toEqual(ungated.merged);
      expect(gated.byPractitioner).toEqual(ungated.byPractitioner);
    });

    it('skips the lookup entirely when the caller passes no cart', async () => {
      await compute();
      expect(loadResourceGateContext).not.toHaveBeenCalled();
    });

    it('keeps a slot whose only eligible room is free', async () => {
      loadResourceGateContext.mockResolvedValueOnce(roomContext([]));

      const { merged } = await compute({ serviceIds: ['svc-1'] });

      expect(merged.map((s) => s.startTime.toISOString())).toContain(
        day.start.toISOString()
      );
    });

    it('drops a slot whose only eligible room is already taken', async () => {
      // Room busy 09:00-10:00 — the practitioner is free the whole day, so
      // without the gate these two slots would still be sold.
      const roomBusyUntil = new Date(day.start.getTime() + 60 * 60_000);
      loadResourceGateContext.mockResolvedValueOnce(
        roomContext([{ start: day.start, end: roomBusyUntil }])
      );

      const { merged } = await compute({ serviceIds: ['svc-1'] });
      const starts = merged.map((s) => s.startTime.toISOString());

      expect(starts).not.toContain(day.start.toISOString());
      expect(starts).not.toContain(
        new Date(day.start.getTime() + 30 * 60_000).toISOString()
      );
      expect(starts).toContain(roomBusyUntil.toISOString());
    });

    it('drops the slot when ONE of two required categories cannot be satisfied', async () => {
      // A laser facial needs a room AND the laser. The room is free all day;
      // the laser is not on shift at all (no working intervals), so nothing in
      // that category can serve any slot and the whole day must disappear.
      const base = roomContext([]);
      loadResourceGateContext.mockResolvedValueOnce({
        ...base,
        resourcesByCategory: new Map([
          ...base.resourcesByCategory,
          ['cat-lasers', ['laser-1']],
        ]),
        availabilityByResource: new Map([
          ...base.availabilityByResource,
          [
            'laser-1',
            {
              resourceId: 'laser-1',
              capacity: 1,
              working: [],
              busy: [],
            },
          ],
        ]),
        requirements: [
          ...base.requirements,
          {
            serviceId: 'svc-1',
            categoryId: 'cat-lasers',
            eligibleResourceIds: [],
          },
        ],
      } satisfies ResourceGateContext);

      const { merged } = await compute({ serviceIds: ['svc-1'] });

      expect(merged).toEqual([]);
    });

    it('loads the gate context ONCE for a whole multi-practitioner, multi-slot window', async () => {
      // Pins the N+1 rule: the context spans the request window and every
      // per-slot test against it is in-memory. One call, no matter how many
      // practitioners or slots come back.
      resolveAvailability.mockResolvedValueOnce([
        { practitionerId: 'prac-1', working: [day], busy: [] },
        { practitionerId: 'prac-2', working: [day], busy: [] },
      ]);
      loadResourceGateContext.mockResolvedValueOnce(
        roomContext([], { capacity: 5 })
      );

      const { merged } = await computePractitionerSlots(
        mockDb,
        [PRACTITIONER, { ...PRACTITIONER, id: 'prac-2', name: 'Second' }],
        'org-1',
        null,
        'UTC',
        day.start,
        day.end,
        30,
        'test',
        undefined,
        undefined,
        { serviceIds: ['svc-1'] }
      );

      expect(merged.length).toBeGreaterThan(1);
      expect(loadResourceGateContext).toHaveBeenCalledTimes(1);
    });

    it('passes every cart service, the org time zone and the location through', async () => {
      loadResourceGateContext.mockResolvedValueOnce(null);
      resolveAvailability.mockResolvedValueOnce([
        { practitionerId: 'prac-1', working: [day], busy: [] },
      ]);

      await computePractitionerSlots(
        mockDb,
        [PRACTITIONER],
        'org-1',
        null,
        'Europe/Dublin',
        day.start,
        day.end,
        30,
        'test',
        undefined,
        undefined,
        { serviceIds: ['svc-1', 'svc-2'], locationId: 'loc-1' }
      );

      expect(loadResourceGateContext).toHaveBeenCalledWith(mockDb, {
        organizationId: 'org-1',
        // BOTH services: a cart needing a room and a laser must satisfy both.
        serviceIds: ['svc-1', 'svc-2'],
        from: day.start,
        to: day.end,
        // Never assumed UTC — resource working hours are wall-clock.
        timeZone: 'Europe/Dublin',
        locationId: 'loc-1',
        excludeAppointmentIds: undefined,
      });
    });
  });
});
