import { activeAppointmentStatuses } from '@borradh-workspace/labels';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { getResourceUtilisation } from './get-resource-utilisation.service.js';

const DUBLIN = 'Europe/Dublin';

/** Monday 2026-06-01 00:00 → Monday 2026-06-08 00:00, Dublin wall-clock. */
const WEEK_FROM = new Date('2026-06-01T00:00:00+01:00');
const WEEK_TO = new Date('2026-06-08T00:00:00+01:00');

/** Mon–Fri 09:00–17:00 → 480 min/day × 5 = 2400 min across the week. */
const NINE_TO_FIVE = {
  1: { from: 540, to: 1020 },
  2: { from: 540, to: 1020 },
  3: { from: 540, to: 1020 },
  4: { from: 540, to: 1020 },
  5: { from: 540, to: 1020 },
};

/** Mon–Thu 10:00–14:00 → 240 min/day × 4 = 960 min across the week. */
const BRANCH_HOURS = {
  1: { from: 600, to: 840 },
  2: { from: 600, to: 840 },
  3: { from: 600, to: 840 },
  4: { from: 600, to: 840 },
};

/** Mon–Fri 08:00–20:00 → 720 min/day × 5 = 3600 min across the week. */
const EIGHT_TO_EIGHT = {
  1: { from: 480, to: 1200 },
  2: { from: 480, to: 1200 },
  3: { from: 480, to: 1200 },
  4: { from: 480, to: 1200 },
  5: { from: 480, to: 1200 },
};

/**
 * Every literal value drizzle bound into a condition tree, so a test can prove
 * a guard is actually in the WHERE clause rather than assuming the mock's empty
 * result meant the filter ran.
 */
function boundValues(node: unknown, acc: unknown[] = []): unknown[] {
  if (Array.isArray(node)) {
    for (const child of node) boundValues(child, acc);
    return acc;
  }
  if (!node || typeof node !== 'object') return acc;
  const record = node as Record<string, unknown>;
  if (Array.isArray(record.queryChunks)) boundValues(record.queryChunks, acc);
  else if ('value' in record) acc.push(record.value);
  return acc;
}

describe('getResourceUtilisation', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // DO NOT "tidy" these away — `_resetMocks()` above is NOT sufficient.
    //
    // `createMockDatabase()._resetMocks()` calls `mockClear()`, which resets
    // recorded CALLS but does NOT drain the `mockResolvedValueOnce` queue.
    // These specs queue up to five values per test, and several paths
    // deliberately short-circuit before the last query runs (no resources → no
    // allocation select; no allocations → no `appointmentService` lookup). Any
    // value left in a queue is then handed to the NEXT test as a phantom
    // result, and the failure surfaces in an unrelated case that looks correct.
    // Only `mockReset()` empties the queue, so each mock is reset and its
    // default re-applied.
    //
    // This is a property of the shared helper, not of this file — it will bite
    // any spec whose service can return early.
    mockDb.query.organization.findFirst.mockReset().mockResolvedValue(null);
    mockDb.query.resource.findMany.mockReset().mockResolvedValue([]);
    mockDb.query.organizationLocation.findMany
      .mockReset()
      .mockResolvedValue([]);
    mockDb.query.appointmentService.findMany.mockReset().mockResolvedValue([]);
    mockDb.where.mockReset().mockReturnThis();
  });

  type MockResource = {
    id: string;
    name: string;
    sortOrder: number;
    locationId: string | null;
    workingHours: Record<number, { from: number; to: number }> | null;
    category: { id: string; name: string; sortOrder: number };
  };

  const room = (over: Partial<MockResource> = {}): MockResource => ({
    id: 'res_1',
    name: 'Room 1',
    sortOrder: 0,
    locationId: null,
    workingHours: NINE_TO_FIVE,
    category: { id: 'cat_1', name: 'Rooms', sortOrder: 0 },
    ...over,
  });

  const alloc = (
    appointmentId: string,
    resourceId: string,
    startDate: string,
    endDate: string
  ) => ({
    appointmentId,
    resourceId,
    startDate: new Date(startDate),
    endDate: new Date(endDate),
  });

  const line = (
    appointmentId: string,
    priceCents: number | null,
    servicePriceCents: number | null = null
  ) => ({
    appointmentId,
    priceCents,
    service:
      servicePriceCents === null ? null : { priceCents: servicePriceCents },
  });

  const setup = (opts: {
    resources: MockResource[];
    orgBusinessHours?: Record<number, { from: number; to: number }> | null;
    locations?: {
      id: string;
      openingHours: Record<number, { from: number; to: number }> | null;
      isPrimary: boolean;
    }[];
    allocations?: ReturnType<typeof alloc>[];
    lines?: ReturnType<typeof line>[];
  }) => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      timezone: DUBLIN,
      businessHours: opts.orgBusinessHours ?? null,
    });
    mockDb.query.resource.findMany.mockResolvedValueOnce(opts.resources);
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce(
      opts.locations ?? []
    );
    mockDb.where.mockResolvedValueOnce(opts.allocations ?? []);
    mockDb.query.appointmentService.findMany.mockResolvedValueOnce(
      opts.lines ?? []
    );
  };

  const week = (over: Record<string, unknown> = {}) => ({
    organizationId: 'org_1',
    from: WEEK_FROM,
    to: WEEK_TO,
    ...over,
  });

  it('matches a hand-computed week', async () => {
    // Open: Mon–Fri 09:00–17:00 = 5 × 480 = 2400 min.
    // Booked: Mon 09:00–12:30 (210) + Wed 14:00–15:30 (90) = 300 min.
    // Utilisation: 300 / 2400 = 0.125.
    // Revenue: €150.00 + €90.00 = 24000c over 40 open hours = 600c/hour.
    setup({
      resources: [room()],
      allocations: [
        alloc(
          'appt_1',
          'res_1',
          '2026-06-01T09:00:00+01:00',
          '2026-06-01T12:30:00+01:00'
        ),
        alloc(
          'appt_2',
          'res_1',
          '2026-06-03T14:00:00+01:00',
          '2026-06-03T15:30:00+01:00'
        ),
      ],
      lines: [line('appt_1', 15_000), line('appt_2', 9_000)],
    });

    const data = await expectResult(
      getResourceUtilisation(mockDb as never, week())
    ).toSucceedWith();

    expect(data.rows).toEqual([
      {
        resourceId: 'res_1',
        resourceName: 'Room 1',
        categoryId: 'cat_1',
        categoryName: 'Rooms',
        openMinutes: 2400,
        bookedMinutes: 300,
        utilisation: 0.125,
        revenueCents: 24_000,
        revenuePerOpenHourCents: 600,
      },
    ]);
    expect(data.from).toEqual(WEEK_FROM);
    expect(data.to).toEqual(WEEK_TO);
  });

  it('counts turnaround as booked — the room is occupied during cleanup', async () => {
    // A 60-minute appointment with a 15-minute turnaround holds the room for 75.
    setup({
      resources: [room()],
      allocations: [
        alloc(
          'appt_1',
          'res_1',
          '2026-06-01T09:00:00+01:00',
          '2026-06-01T10:15:00+01:00'
        ),
      ],
      lines: [line('appt_1', 10_000)],
    });

    const data = await expectResult(
      getResourceUtilisation(mockDb as never, week())
    ).toSucceedWith();

    expect(data.rows[0].bookedMinutes).toBe(75);
    expect(data.rows[0].utilisation).toBe(0.0313);
  });

  it('falls back to LOCATION opening hours (not 24h) when workingHours is null', async () => {
    setup({
      resources: [room({ workingHours: null, locationId: 'loc_1' })],
      locations: [
        { id: 'loc_1', openingHours: EIGHT_TO_EIGHT, isPrimary: true },
      ],
      allocations: [
        alloc(
          'appt_1',
          'res_1',
          '2026-06-01T09:00:00+01:00',
          '2026-06-01T12:00:00+01:00'
        ),
      ],
      lines: [line('appt_1', 18_000)],
    });

    const data = await expectResult(
      getResourceUtilisation(mockDb as never, week())
    ).toSucceedWith();

    // 5 × 720 = 3600, NOT 7 × 1440 = 10080.
    expect(data.rows[0].openMinutes).toBe(3600);
    expect(data.rows[0].utilisation).toBe(0.05); // 180 / 3600
  });

  it("uses the org's PRIMARY location when a location-less resource has no hours", async () => {
    setup({
      resources: [room({ workingHours: null, locationId: null })],
      locations: [
        { id: 'loc_other', openingHours: NINE_TO_FIVE, isPrimary: false },
        { id: 'loc_primary', openingHours: EIGHT_TO_EIGHT, isPrimary: true },
      ],
    });

    const data = await expectResult(
      getResourceUtilisation(mockDb as never, week())
    ).toSucceedWith();

    expect(data.rows[0].openMinutes).toBe(3600);
  });

  it('measures a location-less resource against the FILTERED location, not the primary', async () => {
    // "How utilised is this trolley at the branch?" must be answered with the
    // branch's hours. The primary's would silently answer a different question
    // — and understate the branch, since the primary opens far longer here.
    setup({
      resources: [room({ workingHours: null, locationId: null })],
      locations: [
        { id: 'loc_primary', openingHours: EIGHT_TO_EIGHT, isPrimary: true },
        { id: 'loc_branch', openingHours: BRANCH_HOURS, isPrimary: false },
      ],
    });

    const data = await expectResult(
      getResourceUtilisation(
        mockDb as never,
        week({ locationId: 'loc_branch' })
      )
    ).toSucceedWith();

    // 4 × 240 = 960 (the branch), NOT 5 × 720 = 3600 (the primary).
    expect(data.rows[0].openMinutes).toBe(960);
    expect(data.rows[0].openMinutes).not.toBe(3600);
  });

  it('falls back to org business hours when no location hours resolve', async () => {
    setup({
      resources: [room({ workingHours: null, locationId: 'loc_1' })],
      orgBusinessHours: NINE_TO_FIVE,
      locations: [{ id: 'loc_1', openingHours: null, isPrimary: true }],
    });

    const data = await expectResult(
      getResourceUtilisation(mockDb as never, week())
    ).toSucceedWith();

    expect(data.rows[0].openMinutes).toBe(2400);
  });

  it('clips an allocation that straddles the window boundary', async () => {
    // Window is Monday 09:00–17:00; the allocation starts an hour before it.
    setup({
      resources: [room()],
      allocations: [
        alloc(
          'appt_1',
          'res_1',
          '2026-06-01T08:00:00+01:00',
          '2026-06-01T10:00:00+01:00'
        ),
      ],
      lines: [line('appt_1', 12_000)],
    });

    const data = await expectResult(
      getResourceUtilisation(
        mockDb as never,
        week({
          from: new Date('2026-06-01T09:00:00+01:00'),
          to: new Date('2026-06-01T17:00:00+01:00'),
        })
      )
    ).toSucceedWith();

    expect(data.rows[0].openMinutes).toBe(480);
    // The 120-minute hold contributes only its in-window hour.
    expect(data.rows[0].bookedMinutes).toBe(60);
    expect(data.rows[0].utilisation).toBe(0.125);
  });

  it('reports 0 (never NaN) for a resource with no bookings', async () => {
    setup({ resources: [room()] });

    const data = await expectResult(
      getResourceUtilisation(mockDb as never, week())
    ).toSucceedWith();

    const [row] = data.rows;
    expect(row.bookedMinutes).toBe(0);
    expect(row.utilisation).toBe(0);
    expect(row.revenueCents).toBe(0);
    expect(row.revenuePerOpenHourCents).toBe(0);
    expect(Number.isNaN(row.utilisation)).toBe(false);
  });

  it('reports 0 (never Infinity) when the resource is never open', async () => {
    setup({
      // Non-null but empty: the resource has hours and they are "never".
      resources: [room({ workingHours: {} })],
      allocations: [
        alloc(
          'appt_1',
          'res_1',
          '2026-06-01T09:00:00+01:00',
          '2026-06-01T11:00:00+01:00'
        ),
      ],
      lines: [line('appt_1', 5_000)],
    });

    const data = await expectResult(
      getResourceUtilisation(mockDb as never, week())
    ).toSucceedWith();

    const [row] = data.rows;
    expect(row.openMinutes).toBe(0);
    expect(row.bookedMinutes).toBe(120);
    expect(row.utilisation).toBe(0);
    expect(row.revenueCents).toBe(5_000);
    expect(row.revenuePerOpenHourCents).toBe(0);
    expect(Number.isFinite(row.utilisation)).toBe(true);
    expect(Number.isFinite(row.revenuePerOpenHourCents)).toBe(true);
  });

  it('splits an appointment evenly across the resources it holds', async () => {
    setup({
      resources: [
        room({ id: 'res_a', name: 'Room A' }),
        room({
          id: 'res_b',
          name: 'Laser B',
          sortOrder: 1,
          category: { id: 'cat_2', name: 'Lasers', sortOrder: 1 },
        }),
      ],
      allocations: [
        alloc(
          'appt_1',
          'res_a',
          '2026-06-01T09:00:00+01:00',
          '2026-06-01T10:00:00+01:00'
        ),
        alloc(
          'appt_1',
          'res_b',
          '2026-06-01T09:00:00+01:00',
          '2026-06-01T10:00:00+01:00'
        ),
      ],
      lines: [line('appt_1', 15_000)],
    });

    const data = await expectResult(
      getResourceUtilisation(mockDb as never, week())
    ).toSucceedWith();

    expect(data.rows.map((r) => r.revenueCents)).toEqual([7_500, 7_500]);
    // Category subtotals reconcile to the appointment total, not double it.
    expect(data.rows.reduce((sum, r) => sum + r.revenueCents, 0)).toBe(15_000);
  });

  it('gives an odd remaining cent to the lowest resourceId so the split reconciles exactly', async () => {
    setup({
      resources: [
        room({ id: 'res_a', name: 'Room A' }),
        room({
          id: 'res_b',
          name: 'Laser B',
          sortOrder: 1,
          category: { id: 'cat_2', name: 'Lasers', sortOrder: 1 },
        }),
      ],
      allocations: [
        alloc(
          'appt_1',
          'res_b',
          '2026-06-01T09:00:00+01:00',
          '2026-06-01T10:00:00+01:00'
        ),
        alloc(
          'appt_1',
          'res_a',
          '2026-06-01T09:00:00+01:00',
          '2026-06-01T10:00:00+01:00'
        ),
      ],
      // 9999 is odd — a naive round() on each half would return 10000 in total.
      lines: [line('appt_1', 9_999)],
    });

    const data = await expectResult(
      getResourceUtilisation(mockDb as never, week())
    ).toSucceedWith();

    const byId = new Map(data.rows.map((r) => [r.resourceId, r.revenueCents]));
    expect(byId.get('res_a')).toBe(5_000);
    expect(byId.get('res_b')).toBe(4_999);
    expect((byId.get('res_a') ?? 0) + (byId.get('res_b') ?? 0)).toBe(9_999);
  });

  it('falls back to the catalogue price when a line item has no snapshot price', async () => {
    setup({
      resources: [room()],
      allocations: [
        alloc(
          'appt_1',
          'res_1',
          '2026-06-01T09:00:00+01:00',
          '2026-06-01T10:00:00+01:00'
        ),
      ],
      lines: [line('appt_1', null, 8_000), line('appt_1', null, null)],
    });

    const data = await expectResult(
      getResourceUtilisation(mockDb as never, week())
    ).toSucceedWith();

    expect(data.rows[0].revenueCents).toBe(8_000);
  });

  it('contributes nothing for cancelled or no-show appointments', async () => {
    // The status guard lives in the WHERE clause, so a cancelled appointment's
    // (leaked) allocation never comes back.
    setup({ resources: [room()] });

    const data = await expectResult(
      getResourceUtilisation(mockDb as never, week())
    ).toSucceedWith();

    expect(data.rows[0].bookedMinutes).toBe(0);
    expect(data.rows[0].revenueCents).toBe(0);

    // Prove the empty result was the filter, not the fixture: the query joins
    // back to `appointment` and restricts status to the active set only.
    expect(mockDb.innerJoin).toHaveBeenCalled();
    const values = boundValues(mockDb.where.mock.calls[0]?.[0]);
    for (const status of activeAppointmentStatuses) {
      expect(values).toContain(status);
    }
    expect(values).not.toContain('cancelled');
    expect(values).not.toContain('no_show');
    expect(values).not.toContain('completed');
  });

  it('orders rows by category, then resource sortOrder, then name', async () => {
    setup({
      resources: [
        room({
          id: 'res_laser',
          name: 'Laser A',
          sortOrder: 0,
          category: { id: 'cat_2', name: 'Lasers', sortOrder: 1 },
        }),
        room({ id: 'res_b', name: 'Bravo', sortOrder: 1 }),
        room({ id: 'res_c', name: 'Alpha', sortOrder: 1 }),
        room({ id: 'res_a', name: 'Room 1', sortOrder: 0 }),
      ],
    });

    const data = await expectResult(
      getResourceUtilisation(mockDb as never, week())
    ).toSucceedWith();

    expect(data.rows.map((r) => r.resourceId)).toEqual([
      'res_a',
      'res_c',
      'res_b',
      'res_laser',
    ]);
  });

  it('returns no rows when the org has no active resources', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      timezone: DUBLIN,
      businessHours: NINE_TO_FIVE,
    });
    mockDb.query.resource.findMany.mockResolvedValueOnce([]);

    const data = await expectResult(
      getResourceUtilisation(mockDb as never, week())
    ).toSucceedWith();

    expect(data.rows).toEqual([]);
    // No resources means nothing to look allocations up for.
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('accepts a location filter', async () => {
    setup({ resources: [room({ locationId: 'loc_1' })] });

    await expectResult(
      getResourceUtilisation(mockDb as never, week({ locationId: 'loc_1' }))
    ).toSucceedWith();

    expect(mockDb.query.resource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.anything() })
    );
  });

  it('returns VALIDATION_ERROR when `to` is before `from`', async () => {
    await expectResult(
      getResourceUtilisation(
        mockDb as never,
        week({ from: WEEK_TO, to: WEEK_FROM })
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.organization.findFirst).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when `to` equals `from`', async () => {
    await expectResult(
      getResourceUtilisation(mockDb as never, week({ to: WEEK_FROM }))
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR when organizationId is missing', async () => {
    await expectResult(
      getResourceUtilisation(
        mockDb as never,
        {
          from: WEEK_FROM,
          to: WEEK_TO,
        } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.organization.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      getResourceUtilisation(mockDb as never, week())
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
