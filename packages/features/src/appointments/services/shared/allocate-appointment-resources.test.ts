import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import * as resourceGateModule from '../../../scheduling/services/resolve-resource-availability/filter-slots-by-resources.js';
import { ErrorCodes } from '../../../shared/index.js';
import {
  ResourceAllocationError,
  allocateAppointmentResources,
  checkAppointmentResourcesAvailable,
} from './allocate-appointment-resources.js';

// Restored `vi.spyOn`, NOT `vi.mock`: under `isolate: false` the worker shares
// one module graph, so a hoisted factory both deletes the exports it omits for
// every later file and silently misses when an earlier file already imported
// the real module. The service imports these through the barrel
// (`.../resolve-resource-availability/index.js`), and a barrel re-export is a
// live binding, so spying the SOURCE module is what the barrel then sees.
let loadResourceGateContextSpy: MockInstance;
let pickResourcesForSpy: MockInstance;

/** Stand-in for the engine's opaque context — the service never inspects it. */
const GATE_CONTEXT = {} as never;

/**
 * The shape drizzle 0.45.2 actually throws.
 *
 * The outer error's message is the SQL text ("Failed query: …"), which does NOT
 * contain the constraint name; the driver error carrying SQLSTATE 23P01 and
 * `constraint_name` is on `.cause`. A test that throws a bare
 * `new Error('resource_no_overlap')` would pass against a message match and
 * still ship a 500 — which is exactly the trap this fixture exists to avoid.
 */
const drizzleExclusionViolation = () =>
  Object.assign(
    new Error(
      'Failed query: insert into "appointment_resource" (...) values (...)\nparams: ...'
    ),
    {
      cause: Object.assign(
        new Error(
          'conflicting key value violates exclusion constraint "resource_no_overlap"'
        ),
        { code: '23P01', constraint_name: 'resource_no_overlap' }
      ),
    }
  );

/**
 * The OTHER shape the same race throws.
 *
 * Postgres enforces an exclusion constraint by making each inserter wait on the
 * transaction owning a conflicting index entry, so two bookings taking the same
 * rooms wait on each other and one is killed with 40P01 — no constraint name,
 * no 23P01, just "deadlock detected". Which of the two codes a loser gets is a
 * matter of interleaving, which is why this one only ever showed up under CI
 * load.
 */
const drizzleDeadlock = () =>
  Object.assign(
    new Error(
      'Failed query: insert into "appointment_resource" (...) values (...)\nparams: ...'
    ),
    {
      cause: Object.assign(new Error('deadlock detected'), { code: '40P01' }),
    }
  );

describe('allocateAppointmentResources', () => {
  const mockDb = createMockDatabase();

  const baseInput = {
    organizationId: 'org_1',
    appointmentId: 'appt_1',
    serviceIds: ['svc_1'],
    startDate: new Date('2026-03-02T10:00:00Z'),
    endDate: new Date('2026-03-02T11:00:00Z'),
    timeZone: 'Europe/Dublin',
    isManual: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // `mockClear`/`clearAllMocks` clear CALLS but not queued `…Once`
    // implementations, so an unconsumed `mockResolvedValueOnce` from an earlier
    // test would be served to the next one's first query — silently shifting
    // every subsequent read by one. Reset the builder methods outright and put
    // their chainability back.
    for (const method of [
      mockDb.select,
      mockDb.from,
      mockDb.leftJoin,
      mockDb.where,
      mockDb.insert,
      mockDb.values,
      mockDb.delete,
    ]) {
      method.mockReset().mockReturnThis();
    }
    mockDb.query.orgDefaults.findFirst.mockReset().mockResolvedValue(null);
    loadResourceGateContextSpy = vi
      .spyOn(resourceGateModule, 'loadResourceGateContext')
      .mockResolvedValue(GATE_CONTEXT);
    pickResourcesForSpy = vi
      .spyOn(resourceGateModule, 'pickResourcesFor')
      .mockReturnValue(null);
  });

  afterEach(() => {
    loadResourceGateContextSpy.mockRestore();
    pickResourcesForSpy.mockRestore();
  });

  // ── The rollout-safety guarantee ─────────────────────────────────────────
  describe('zero-cost path', () => {
    /** `queueExplicit`, but with the requirement rows chosen per test. */
    const queueExplicitFor = (
      requirements: Array<{ categoryId: string }>,
      resources: Array<Record<string, unknown>>
    ) => {
      mockDb.where
        .mockResolvedValueOnce(requirements)
        .mockResolvedValueOnce(resources)
        .mockResolvedValueOnce([{ turnaroundMinutes: 10 }])
        .mockResolvedValueOnce([]);
    };

    it('does nothing at all when no service has a requirement', async () => {
      loadResourceGateContextSpy.mockResolvedValue(null);

      const result = await allocateAppointmentResources(mockDb as never, {
        ...baseInput,
      });

      expect(result).toEqual({ allocated: [], warnings: [] });
      expect(mockDb.insert).not.toHaveBeenCalled();
      // Not one further query: no selection, and crucially no `org_defaults`
      // read. An org that never set a room up must pay exactly the one lookup
      // that found nothing.
      expect(pickResourcesForSpy).not.toHaveBeenCalled();
      expect(mockDb.query.orgDefaults.findFirst).not.toHaveBeenCalled();
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    /**
     * Named resources are honoured even when NO service in the cart requires
     * anything — the front desk putting a facial in a treatment room.
     *
     * This is the one path that runs ahead of the zero-cost guard, and it has
     * to: behind the guard the ids were read by nothing and the booking
     * quietly held no room at all. The guarantee is unaffected, because an org
     * with no resources has nothing to name.
     */
    it('still honours explicit resources when nothing is required', async () => {
      loadResourceGateContextSpy.mockResolvedValue(null);
      queueExplicitFor(
        [],
        [{ id: 'res_1', name: 'Room 1', categoryId: 'cat_room', capacity: 1 }]
      );

      const result = await allocateAppointmentResources(mockDb as never, {
        ...baseInput,
        explicitResourceIds: ['res_1'],
      });

      expect(result.allocated).toEqual([
        { categoryId: 'cat_room', resourceId: 'res_1' },
      ]);
      const [written] = mockDb.values.mock.calls[0][0] as Array<
        Record<string, unknown>
      >;
      // Turnaround belongs to the requirement. There is no requirement here,
      // so the room is held for the appointment and not a minute longer.
      expect(written.turnaroundMinutes).toBe(0);
    });
  });

  // ── Online: hard block ───────────────────────────────────────────────────
  describe('online booking with nothing free', () => {
    it('throws a CONFLICT naming the category, and writes nothing', async () => {
      pickResourcesForSpy.mockReturnValue(null);
      queueDiagnosis({
        turnaround: [{ turnaroundMinutes: 15 }],
        requirements: [{ categoryId: 'cat_room' }],
        eligibility: [],
        categories: [{ id: 'cat_room', name: 'Treatment room' }],
        resources: [
          {
            id: 'res_1',
            name: 'Room 1',
            categoryId: 'cat_room',
            capacity: 1,
          },
        ],
        conflicts: [
          {
            resourceId: 'res_1',
            start: new Date('2026-03-02T10:30:00Z'),
            end: new Date('2026-03-02T11:30:00Z'),
            appointmentTitle: 'Botox — Jane',
          },
        ],
      });

      const error = await allocateAppointmentResources(mockDb as never, {
        ...baseInput,
        isManual: false,
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ResourceAllocationError);
      const allocationError = error as ResourceAllocationError;
      expect(allocationError.code).toBe(ErrorCodes.CONFLICT);
      expect(allocationError.message).toBe(
        'No Treatment room is available at this time'
      );
      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });

  // ── Manual: warn, don't block ────────────────────────────────────────────
  describe('manual booking with nothing free', () => {
    it('allocates the least-conflicted resource with allowOverlap and warns', async () => {
      pickResourcesForSpy.mockReturnValue(null);
      queueDiagnosis({
        turnaround: [{ turnaroundMinutes: 15 }],
        requirements: [{ categoryId: 'cat_room' }],
        eligibility: [],
        categories: [{ id: 'cat_room', name: 'Treatment room' }],
        resources: [
          { id: 'res_1', name: 'Room 1', categoryId: 'cat_room', capacity: 1 },
          { id: 'res_2', name: 'Room 2', categoryId: 'cat_room', capacity: 1 },
        ],
        conflicts: [
          {
            resourceId: 'res_1',
            start: new Date('2026-03-02T09:00:00Z'),
            end: new Date('2026-03-02T12:00:00Z'),
            appointmentTitle: 'Filler — Aoife',
          },
          {
            resourceId: 'res_1',
            start: new Date('2026-03-02T10:30:00Z'),
            end: new Date('2026-03-02T11:00:00Z'),
            appointmentTitle: 'Consult — Mark',
          },
          {
            resourceId: 'res_2',
            start: new Date('2026-03-02T10:15:00Z'),
            end: new Date('2026-03-02T10:45:00Z'),
            appointmentTitle: 'Peel — Sinead',
          },
        ],
      });

      const result = await allocateAppointmentResources(mockDb as never, {
        ...baseInput,
        isManual: true,
      });

      // Room 2 has one clash, Room 1 has two — the least-conflicted wins.
      expect(result.allocated).toEqual([
        { categoryId: 'cat_room', resourceId: 'res_2' },
      ]);
      expect(result.warnings).toEqual([
        {
          categoryId: 'cat_room',
          categoryName: 'Treatment room',
          resourceId: 'res_2',
          resourceName: 'Room 2',
          conflictingAppointmentTitle: 'Peel — Sinead',
          conflictStart: new Date('2026-03-02T10:15:00Z'),
          conflictEnd: new Date('2026-03-02T10:45:00Z'),
        },
      ]);

      const [written] = mockDb.values.mock.calls[0][0] as Array<
        Record<string, unknown>
      >;
      // Opted out of `resource_no_overlap` — a deliberate staff override.
      expect(written.allowOverlap).toBe(true);
      expect(written.turnaroundMinutes).toBe(15);
      // The HOLD runs past the appointment by the turnaround; the appointment
      // itself is untouched.
      expect(written.endDate).toEqual(new Date('2026-03-02T11:15:00Z'));
    });

    it('warns without allocating when the required category has no resources at all', async () => {
      pickResourcesForSpy.mockReturnValue(null);
      queueDiagnosis({
        turnaround: [],
        requirements: [{ categoryId: 'cat_laser' }],
        eligibility: [],
        categories: [{ id: 'cat_laser', name: 'Lasers' }],
        resources: [],
        conflicts: [],
      });

      const result = await allocateAppointmentResources(mockDb as never, {
        ...baseInput,
        isManual: true,
      });

      expect(result.allocated).toEqual([]);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].categoryName).toBe('Lasers');
      expect(result.warnings[0].resourceId).toBeNull();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });

  // ── Assignment mode ──────────────────────────────────────────────────────
  describe('assignment mode', () => {
    it('creates NO allocation for a console booking when the org assigns manually', async () => {
      mockDb.query.orgDefaults.findFirst.mockResolvedValueOnce({
        resourceAssignmentMode: 'manual',
      });

      const result = await allocateAppointmentResources(mockDb as never, {
        ...baseInput,
        isManual: true,
      });

      expect(result).toEqual({ allocated: [], warnings: [] });
      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(pickResourcesForSpy).not.toHaveBeenCalled();
    });

    it('STILL auto-assigns an online booking when the org assigns manually', async () => {
      // A client cannot pick a room, so honouring manual mode online would
      // leave every online slot ungated — the exact hole this feature closes.
      mockDb.query.orgDefaults.findFirst.mockResolvedValueOnce({
        resourceAssignmentMode: 'manual',
      });
      pickResourcesForSpy.mockReturnValue([
        { categoryId: 'cat_room', resourceId: 'res_1', turnaroundMinutes: 0 },
      ]);
      mockDb.where.mockResolvedValueOnce([
        {
          id: 'res_1',
          name: 'Room 1',
          categoryId: 'cat_room',
          categoryName: 'Treatment room',
          capacity: 1,
        },
      ]);

      const result = await allocateAppointmentResources(mockDb as never, {
        ...baseInput,
        isManual: false,
      });

      expect(result.allocated).toEqual([
        { categoryId: 'cat_room', resourceId: 'res_1' },
      ]);
      expect(mockDb.insert).toHaveBeenCalled();
      const [written] = mockDb.values.mock.calls[0][0] as Array<
        Record<string, unknown>
      >;
      expect(written.source).toBe('auto');
      expect(written.allowOverlap).toBe(false);
    });

    it('defaults to auto when org_defaults has no row', async () => {
      pickResourcesForSpy.mockReturnValue([
        { categoryId: 'cat_room', resourceId: 'res_1', turnaroundMinutes: 0 },
      ]);
      mockDb.where.mockResolvedValueOnce([
        {
          id: 'res_1',
          name: 'Room 1',
          categoryId: 'cat_room',
          categoryName: 'Treatment room',
          capacity: 1,
        },
      ]);

      const result = await allocateAppointmentResources(mockDb as never, {
        ...baseInput,
        isManual: true,
      });

      expect(result.allocated).toHaveLength(1);
    });
  });

  // ── Capacity ─────────────────────────────────────────────────────────────
  it('sets allowOverlap for a capacity > 1 resource (the constraint cannot count to N)', async () => {
    pickResourcesForSpy.mockReturnValue([
      { categoryId: 'cat_chair', resourceId: 'res_bar', turnaroundMinutes: 0 },
    ]);
    mockDb.where.mockResolvedValueOnce([
      {
        id: 'res_bar',
        name: 'Nail bar',
        categoryId: 'cat_chair',
        categoryName: 'Stations',
        capacity: 4,
      },
    ]);

    await allocateAppointmentResources(mockDb as never, baseInput);

    const [written] = mockDb.values.mock.calls[0][0] as Array<
      Record<string, unknown>
    >;
    expect(written.allowOverlap).toBe(true);
  });

  // ── Explicit ids ─────────────────────────────────────────────────────────
  describe('explicit resource ids', () => {
    const queueExplicit = (
      resources: Array<Record<string, unknown>>,
      requirements: Array<{ categoryId: string }> = [{ categoryId: 'cat_room' }]
    ) => {
      mockDb.where
        .mockResolvedValueOnce(requirements) // required categories
        .mockResolvedValueOnce(resources) // the named resources
        .mockResolvedValueOnce([{ turnaroundMinutes: 10 }]) // turnaround
        // Existing holds on the named resources — the capacity count. Empty
        // here; the over-capacity case has its own test below.
        .mockResolvedValueOnce([]);
    };

    it('honours them and records them as staff-chosen', async () => {
      queueExplicit([
        { id: 'res_7', name: 'Room 7', categoryId: 'cat_room', capacity: 1 },
      ]);

      const result = await allocateAppointmentResources(mockDb as never, {
        ...baseInput,
        isManual: true,
        explicitResourceIds: ['res_7'],
      });

      expect(result.allocated).toEqual([
        { categoryId: 'cat_room', resourceId: 'res_7' },
      ]);
      const [written] = mockDb.values.mock.calls[0][0] as Array<
        Record<string, unknown>
      >;
      expect(written.source).toBe('manual');
      expect(written.turnaroundMinutes).toBe(10);
      // Not force-overlapped: if the operator picked a busy room, the exclusion
      // constraint decides and surfaces as a CONFLICT.
      expect(written.allowOverlap).toBe(false);
      expect(pickResourcesForSpy).not.toHaveBeenCalled();
    });

    it('rejects a resource from another org (or an inactive/deleted one)', async () => {
      queueExplicit([]); // the org-scoped, active-only read found nothing

      const error = await allocateAppointmentResources(mockDb as never, {
        ...baseInput,
        isManual: true,
        explicitResourceIds: ['res_other_org'],
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ResourceAllocationError);
      expect((error as ResourceAllocationError).code).toBe(
        ErrorCodes.VALIDATION_ERROR
      );
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    // Requirements decide what is GATED, not what staff may record. A room in
    // a category nothing requires is a normal front-desk choice, so it is
    // held — with no turnaround, which belongs to the requirement.
    it('honours a resource whose category no service requires, with no turnaround', async () => {
      // No requirements at all — otherwise `cat_room` stays uncovered and the
      // allocator goes on to auto-fill it, which is a different test.
      queueExplicit(
        [{ id: 'res_9', name: 'Sunbed', categoryId: 'cat_other', capacity: 1 }],
        []
      );

      const result = await allocateAppointmentResources(mockDb as never, {
        ...baseInput,
        isManual: true,
        explicitResourceIds: ['res_9'],
      });

      expect(result.allocated).toEqual([
        { categoryId: 'cat_other', resourceId: 'res_9' },
      ]);
      const [written] = mockDb.values.mock.calls[0][0] as Array<
        Record<string, unknown>
      >;
      expect(written.turnaroundMinutes).toBe(0);
    });

    it('rejects two resources from the same category', async () => {
      queueExplicit([
        { id: 'res_1', name: 'Room 1', categoryId: 'cat_room', capacity: 1 },
        { id: 'res_2', name: 'Room 2', categoryId: 'cat_room', capacity: 1 },
      ]);

      const error = await allocateAppointmentResources(mockDb as never, {
        ...baseInput,
        isManual: true,
        explicitResourceIds: ['res_1', 'res_2'],
      }).catch((e: unknown) => e);

      expect((error as ResourceAllocationError).code).toBe(
        ErrorCodes.VALIDATION_ERROR
      );
    });
  });

  // ── The race the constraint exists for ───────────────────────────────────
  describe('resource_no_overlap violation', () => {
    const arrangeInsertFailure = (error: unknown) => {
      pickResourcesForSpy.mockReturnValue([
        { categoryId: 'cat_room', resourceId: 'res_1', turnaroundMinutes: 0 },
      ]);
      mockDb.where.mockResolvedValueOnce([
        {
          id: 'res_1',
          name: 'Room 1',
          categoryId: 'cat_room',
          categoryName: 'Treatment room',
          capacity: 1,
        },
      ]);
      mockDb.values.mockRejectedValueOnce(error);
    };

    it('maps the drizzle-wrapped 23P01 to CONFLICT, never a 500', async () => {
      arrangeInsertFailure(drizzleExclusionViolation());

      const error = await allocateAppointmentResources(
        mockDb as never,
        baseInput
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ResourceAllocationError);
      expect((error as ResourceAllocationError).code).toBe(ErrorCodes.CONFLICT);
    });

    it('maps a DEADLOCK to CONFLICT too — the same race, a different SQLSTATE', async () => {
      arrangeInsertFailure(drizzleDeadlock());

      const error = await allocateAppointmentResources(
        mockDb as never,
        baseInput
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ResourceAllocationError);
      expect((error as ResourceAllocationError).code).toBe(ErrorCodes.CONFLICT);
    });

    it('does NOT map an unrelated failure that merely mentions the constraint', async () => {
      // The guard is SQLSTATE 23P01 on the cause chain — not the message. An
      // error whose text happens to contain the constraint name is a real
      // fault and must stay an INTERNAL_ERROR.
      arrangeInsertFailure(
        Object.assign(
          new Error(
            'Failed query: insert into "appointment_resource" -- resource_no_overlap'
          ),
          {
            cause: Object.assign(new Error('relation does not exist'), {
              code: '42P01',
            }),
          }
        )
      );

      const error = await allocateAppointmentResources(
        mockDb as never,
        baseInput
      ).catch((e: unknown) => e);

      expect((error as ResourceAllocationError).code).toBe(
        ErrorCodes.INTERNAL_ERROR
      );
    });
  });

  /**
   * Queue the diagnosis reads, in the order the service issues them:
   * turnaround → requirements → eligibility → categories → resources →
   * conflicts.
   */
  function queueDiagnosis(rows: {
    turnaround: Array<{ turnaroundMinutes: number | null }>;
    requirements: Array<{ categoryId: string }>;
    eligibility: Array<{ resourceId: string }>;
    categories: Array<{ id: string; name: string }>;
    resources: Array<Record<string, unknown>>;
    conflicts: Array<Record<string, unknown>>;
  }) {
    mockDb.where
      .mockResolvedValueOnce(rows.turnaround)
      .mockResolvedValueOnce(rows.requirements)
      .mockResolvedValueOnce(rows.eligibility)
      .mockResolvedValueOnce(rows.categories)
      .mockResolvedValueOnce(rows.resources)
      .mockResolvedValueOnce(rows.conflicts);
  }
});

// ── The staff-side no-block guarantee ───────────────────────────────────────
describe('checkAppointmentResourcesAvailable', () => {
  const mockDb = createMockDatabase();

  const baseInput = {
    organizationId: 'org_1',
    serviceIds: ['svc_1'],
    startDate: new Date('2026-03-02T10:00:00Z'),
    endDate: new Date('2026-03-02T11:00:00Z'),
    timeZone: 'Europe/Dublin',
  };

  let gateSpy: MockInstance;
  let pickSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    gateSpy = vi.spyOn(resourceGateModule, 'loadResourceGateContext');
    pickSpy = vi.spyOn(resourceGateModule, 'pickResourcesFor');
  });

  afterEach(() => {
    gateSpy.mockRestore();
    pickSpy.mockRestore();
  });

  it('NEVER blocks a console booking, even with nothing free', async () => {
    // The product rule: an occupied room is FLAGGED to the front desk, never
    // a refusal. Staff already double-book practitioners and book outside
    // posted hours; taking that away for rooms would make the console worse
    // than the paper diary it replaced. The warning comes from the allocator
    // afterwards — this gate simply has no opinion about manual bookings.
    gateSpy.mockResolvedValue({} as never);
    // Nothing free anywhere.
    pickSpy.mockReturnValue(null);

    const result = await checkAppointmentResourcesAvailable(mockDb as never, {
      ...baseInput,
      isManual: true,
    });

    expect(result).toBeNull();
    // Short-circuits before the gate even loads: a console booking cannot be
    // refused for a room, so there is nothing worth asking the database.
    expect(gateSpy).not.toHaveBeenCalled();
  });

  it('still refuses an ONLINE booking when nothing is free', async () => {
    // The other half of the same rule, and the reason the first half is safe:
    // a customer must never be sold a slot the clinic cannot physically run.
    gateSpy.mockResolvedValue({} as never);
    pickSpy.mockReturnValue(null);
    // resolveTurnaroundMinutes + the naming reads behind the refusal.
    mockDb.where.mockResolvedValue([]);

    const result = await checkAppointmentResourcesAvailable(mockDb as never, {
      ...baseInput,
      isManual: false,
    });

    expect(result).not.toBeNull();
    expect(result?.code).toBe(ErrorCodes.CONFLICT);
  });

  it('passes an online booking through when a room IS free', async () => {
    gateSpy.mockResolvedValue({} as never);
    pickSpy.mockReturnValue([
      { categoryId: 'cat_room', resourceId: 'res_1', turnaroundMinutes: 0 },
    ]);

    const result = await checkAppointmentResourcesAvailable(mockDb as never, {
      ...baseInput,
      isManual: false,
    });

    expect(result).toBeNull();
  });
});
