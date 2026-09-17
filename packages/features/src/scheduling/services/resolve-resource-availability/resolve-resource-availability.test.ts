import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { resolveResourceAvailability } from './resolve-resource-availability.service.js';

// 2026-07-06 is a Monday. July is IST (UTC+1) in Europe/Dublin.
const from = new Date(Date.UTC(2026, 6, 6, 0, 0, 0, 0));
const to = new Date(Date.UTC(2026, 6, 6, 23, 59, 0, 0));

const baseInput = {
  organizationId: 'org_1',
  resourceIds: ['res_1'],
  from,
  to,
  timeZone: 'UTC',
};

/** Room 2: capacity 1, always open (working_hours null). */
const alwaysOpenRoom = {
  id: 'res_1',
  capacity: 1,
  workingHours: null,
};

/**
 * White-box scan of a drizzle SQL condition for a bound parameter value. The
 * mock db never executes SQL, so this is the only way to assert that a filter
 * (here: `excludeAppointmentIds`) actually reached the query.
 */
function conditionBindsValue(node: unknown, value: string): boolean {
  const seen = new Set<unknown>();
  const walk = (current: unknown): boolean => {
    if (current === value) return true;
    if (current === null || typeof current !== 'object') return false;
    if (seen.has(current)) return false;
    seen.add(current);
    return Object.values(current as Record<string, unknown>).some(walk);
  };
  return walk(node);
}

describe('resolveResourceAvailability', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // _resetMocks only clears call history, not the mockResolvedValueOnce
    // queue — reset the chain terminal so leaked onces don't shift later tests.
    mockDb.where.mockReset();
    mockDb.where.mockReturnThis();
  });

  /** Queue the two sequential .where() results: resources, allocations. */
  function queueWheres(opts: {
    resources?: unknown[];
    allocations?: unknown[];
  }) {
    mockDb.where
      .mockResolvedValueOnce(opts.resources ?? [])
      .mockResolvedValueOnce(opts.allocations ?? []);
  }

  it('treats null workingHours as open for the WHOLE window', async () => {
    queueWheres({ resources: [alwaysOpenRoom] });

    const [availability] = await resolveResourceAvailability(
      mockDb as never,
      baseInput
    );

    expect(availability.resourceId).toBe('res_1');
    expect(availability.capacity).toBe(1);
    expect(availability.working).toEqual([{ start: from, end: to }]);
    expect(availability.busy).toHaveLength(0);
  });

  it('expands workingHours into the correct UTC interval for Europe/Dublin', async () => {
    queueWheres({
      resources: [
        // Monday 09:00–17:00 wall clock.
        {
          id: 'res_1',
          capacity: 1,
          workingHours: { 1: { from: 540, to: 1020 } },
        },
      ],
    });

    const [availability] = await resolveResourceAvailability(mockDb as never, {
      ...baseInput,
      timeZone: 'Europe/Dublin',
    });

    // IST is UTC+1 in July, so 09:00 local is 08:00Z.
    expect(availability.working).toEqual([
      {
        start: new Date(Date.UTC(2026, 6, 6, 8, 0)),
        end: new Date(Date.UTC(2026, 6, 6, 16, 0)),
      },
    ]);
  });

  it('emits no working intervals on a day the resource has no hours for', async () => {
    queueWheres({
      resources: [
        // Tuesday only; the window is a Monday.
        {
          id: 'res_1',
          capacity: 1,
          workingHours: { 2: { from: 540, to: 1020 } },
        },
      ],
    });

    const [availability] = await resolveResourceAvailability(
      mockDb as never,
      baseInput
    );

    expect(availability.working).toHaveLength(0);
  });

  it('returns allocation ranges verbatim as busy (turnaround already baked in)', async () => {
    queueWheres({
      resources: [alwaysOpenRoom],
      allocations: [
        {
          resourceId: 'res_1',
          startDate: new Date(Date.UTC(2026, 6, 6, 10, 0)),
          // 10:00–11:00 appointment + 15 minutes of cleanup.
          endDate: new Date(Date.UTC(2026, 6, 6, 11, 15)),
        },
      ],
    });

    const [availability] = await resolveResourceAvailability(
      mockDb as never,
      baseInput
    );

    expect(availability.busy).toEqual([
      {
        start: new Date(Date.UTC(2026, 6, 6, 10, 0)),
        end: new Date(Date.UTC(2026, 6, 6, 11, 15)),
      },
    ]);
  });

  it('carries capacity through so callers can count concurrent allocations', async () => {
    queueWheres({
      resources: [{ id: 'res_1', capacity: 4, workingHours: null }],
    });

    const [availability] = await resolveResourceAvailability(
      mockDb as never,
      baseInput
    );

    expect(availability.capacity).toBe(4);
  });

  it('drops resources that are inactive or deleted rather than returning them empty', async () => {
    // The query filters them out, so no row comes back for res_2 — a caller
    // must not see an entry it could mistake for "bookable but never free".
    queueWheres({ resources: [alwaysOpenRoom] });

    const results = await resolveResourceAvailability(mockDb as never, {
      ...baseInput,
      resourceIds: ['res_1', 'res_2'],
    });

    expect(results).toHaveLength(1);
    expect(results[0].resourceId).toBe('res_1');
  });

  it('preserves the caller resourceIds order', async () => {
    queueWheres({
      resources: [
        { id: 'res_2', capacity: 1, workingHours: null },
        alwaysOpenRoom,
      ],
    });

    const results = await resolveResourceAvailability(mockDb as never, {
      ...baseInput,
      resourceIds: ['res_1', 'res_2'],
    });

    expect(results.map((r) => r.resourceId)).toEqual(['res_1', 'res_2']);
  });

  it('excludes the rescheduled appointment own allocations from busy', async () => {
    queueWheres({ resources: [alwaysOpenRoom] });

    await resolveResourceAvailability(mockDb as never, {
      ...baseInput,
      excludeAppointmentIds: ['appt_being_moved'],
    });

    // Second .where() is the allocation query.
    const allocationCondition = mockDb.where.mock.calls[1]?.[0];
    expect(conditionBindsValue(allocationCondition, 'appt_being_moved')).toBe(
      true
    );
  });

  it('does not add an appointment filter when nothing is excluded', async () => {
    queueWheres({ resources: [alwaysOpenRoom] });

    await resolveResourceAvailability(mockDb as never, baseInput);

    const allocationCondition = mockDb.where.mock.calls[1]?.[0];
    expect(conditionBindsValue(allocationCondition, 'appt_being_moved')).toBe(
      false
    );
  });

  it('short-circuits with no query when there are no resources to resolve', async () => {
    const results = await resolveResourceAvailability(mockDb as never, {
      ...baseInput,
      resourceIds: [],
    });

    expect(results).toEqual([]);
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});
