import {
  appointment,
  blockedTime,
  blockedTimeException,
  blockedTimePractitioner,
  shift,
  timeOff,
} from '@borradh-workspace/database';
import {
  type MockInstance,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
// Keep the real `filterSlotsByResources` (pure, in-memory) and stub only
// `loadResourceGateContext`, the DB-backed half. Spy the SOURCE module, not the
// barrel: the barrel's re-exports are live getters under Vite SSR and cannot be
// redefined.
import * as resourceGateModule from '../../../scheduling/services/resolve-resource-availability/filter-slots-by-resources.js';
import type { ResourceGateContext } from '../../../scheduling/services/resolve-resource-availability/index.js';
import { ErrorCodes } from '../../../shared/index.js';
import { checkAvailability } from './check-availability.service.js';

// The unified resolver reads scheduling data via the query-builder API
// (`db.select().from(table).where(...)`). We key mocked rows by the table
// object passed to `.from()`, so results are robust to call order/count and to
// checkAvailability being invoked multiple times in one test.
const selectData = new Map<unknown, unknown[]>();

const mockDb = {
  select: vi.fn(() => ({
    from: (table: unknown) => ({
      where: () => Promise.resolve(selectData.get(table) ?? []),
    }),
  })),
  query: {
    organization: {
      findFirst: vi.fn(),
    },
    calendarAccount: {
      findFirst: vi.fn(),
    },
    bookingAccount: {
      findFirst: vi.fn(),
    },
    practitionerService: {
      findMany: vi.fn(),
    },
    organizationLocation: {
      findFirst: vi.fn(),
    },
    organizationLocationOpeningHoursException: {
      findMany: vi.fn(),
    },
  },
};

/** Populate the table-keyed select data for a test. */
function setSelectData(data: {
  shifts?: unknown[];
  timeOff?: unknown[];
  blocked?: unknown[];
  blockedJoins?: unknown[];
  blockedExceptions?: unknown[];
  appointments?: unknown[];
}) {
  selectData.set(shift, data.shifts ?? []);
  selectData.set(timeOff, data.timeOff ?? []);
  selectData.set(blockedTime, data.blocked ?? []);
  selectData.set(blockedTimePractitioner, data.blockedJoins ?? []);
  selectData.set(blockedTimeException, data.blockedExceptions ?? []);
  selectData.set(appointment, data.appointments ?? []);
}

/**
 * A gate context with ONE category ("rooms") holding one always-open resource,
 * busy for the given ranges. Turnaround is 0 so the hold is exactly the slot.
 */
function roomContext(
  busy: { start: Date; end: Date }[] = [],
  extra: Partial<ResourceGateContext> = {}
): ResourceGateContext {
  return {
    resourcesByCategory: new Map([['cat-rooms', ['room-1']]]),
    availabilityByResource: new Map([
      [
        'room-1',
        {
          resourceId: 'room-1',
          capacity: 1,
          working: [{ start: new Date(0), end: new Date(8.64e15) }],
          busy,
        },
      ],
    ]),
    requirements: [
      { serviceId: 'svc-1', categoryId: 'cat-rooms', eligibleResourceIds: [] },
    ],
    turnaroundMinutes: 0,
    ...extra,
  };
}

describe('checkAvailability', () => {
  let loadResourceGateContext: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    selectData.clear();
    setSelectData({});
    loadResourceGateContext = vi
      .spyOn(resourceGateModule, 'loadResourceGateContext')
      // Default: no service in the cart has a requirement — the state every
      // existing org is in.
      .mockResolvedValue(null);
  });

  afterEach(() => loadResourceGateContext.mockRestore());

  const validInput = {
    organizationId: 'org-123',
    date: '2024-01-15',
    timePreference: 'any' as const,
  };

  describe('validation', () => {
    it('returns VALIDATION_ERROR for missing organizationId', async () => {
      const result = await checkAvailability(mockDb as never, {
        ...validInput,
        organizationId: '',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });

    it('returns VALIDATION_ERROR for invalid date format', async () => {
      const result = await checkAvailability(mockDb as never, {
        ...validInput,
        date: '15-01-2024', // Wrong format
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });

    it('returns VALIDATION_ERROR for invalid date format (no dashes)', async () => {
      const result = await checkAvailability(mockDb as never, {
        ...validInput,
        date: '20240115',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });

    it('returns VALIDATION_ERROR for invalid duration (too short)', async () => {
      const result = await checkAvailability(mockDb as never, {
        ...validInput,
        duration: 5, // Min is 15
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });

    it('returns VALIDATION_ERROR for invalid duration (too long)', async () => {
      const result = await checkAvailability(mockDb as never, {
        ...validInput,
        duration: 500, // Max is 480
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });
  });

  describe('organization lookup', () => {
    it('returns NOT_FOUND when organization does not exist', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce(null);

      const result = await checkAvailability(mockDb as never, validInput);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(result.error.message).toContain('Organization not found');
      }
    });

    it('returns VALIDATION_ERROR when no primary calendar is configured', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        primaryCalendarType: null,
        primaryCalendarAccountId: null,
      });

      const result = await checkAvailability(mockDb as never, validInput);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(result.error.message).toContain(
          'No primary calendar configured'
        );
      }
    });

    it('returns VALIDATION_ERROR when primary calendar type is set but account ID is missing', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        primaryCalendarType: 'google_calendar',
        primaryCalendarAccountId: null,
      });

      const result = await checkAvailability(mockDb as never, validInput);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });
  });

  describe('provider routing', () => {
    it('returns INTERNAL_ERROR for unsupported provider (phorest)', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        primaryCalendarType: 'phorest',
        primaryCalendarAccountId: 'account-123',
      });

      const result = await checkAvailability(mockDb as never, validInput);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
        expect(result.error.message).toContain('phorest');
      }
    });

    it('returns INTERNAL_ERROR for unsupported provider (fresha)', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        primaryCalendarType: 'fresha',
        primaryCalendarAccountId: 'account-123',
      });

      const result = await checkAvailability(mockDb as never, validInput);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
        expect(result.error.message).toContain('fresha');
      }
    });

    it('returns VALIDATION_ERROR for unknown provider', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        primaryCalendarType: 'unknown_provider',
        primaryCalendarAccountId: 'account-123',
      });

      const result = await checkAvailability(mockDb as never, validInput);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(result.error.message).toContain('Unknown calendar provider');
      }
    });
  });

  describe('Google Calendar - account not found', () => {
    it('returns NOT_FOUND when calendar account does not exist', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        primaryCalendarType: 'google_calendar',
        primaryCalendarAccountId: 'cal-123',
      });
      mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce(null);

      const result = await checkAvailability(mockDb as never, validInput);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(result.error.message).toContain('Calendar account not found');
      }
    });

    it('returns VALIDATION_ERROR when calendar account is not active', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        primaryCalendarType: 'google_calendar',
        primaryCalendarAccountId: 'cal-123',
      });
      mockDb.query.calendarAccount.findFirst.mockResolvedValueOnce({
        id: 'cal-123',
        isActive: false,
      });

      const result = await checkAvailability(mockDb as never, validInput);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(result.error.message).toContain('not active');
      }
    });
  });

  describe('Calendly - account not found', () => {
    it('returns NOT_FOUND when booking account does not exist', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        primaryCalendarType: 'calendly',
        primaryCalendarAccountId: 'booking-123',
      });
      mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce(null);

      const result = await checkAvailability(mockDb as never, validInput);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(result.error.message).toContain('Calendly account not found');
      }
    });

    it('returns VALIDATION_ERROR when booking account is not active', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        primaryCalendarType: 'calendly',
        primaryCalendarAccountId: 'booking-123',
      });
      mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce({
        id: 'booking-123',
        isActive: false,
      });

      const result = await checkAvailability(mockDb as never, validInput);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(result.error.message).toContain('not active');
      }
    });
  });

  describe('practitioner path (serviceId)', () => {
    const orgWithBusinessHours = {
      id: 'org-123',
      // serviceId path doesn't require a primary calendar
      primaryCalendarType: null,
      primaryCalendarAccountId: null,
      // Mon–Fri 09:00–17:00 (minutes from midnight)
      businessHours: {
        0: null,
        1: { from: 540, to: 1020 },
        2: { from: 540, to: 1020 },
        3: { from: 540, to: 1020 },
        4: { from: 540, to: 1020 },
        5: { from: 540, to: 1020 },
        6: null,
      },
      defaultAppointmentDuration: 30,
    };

    // 2026-06-01 is a Monday
    const serviceInput = {
      organizationId: 'org-123',
      date: '2026-06-01',
      serviceId: 'svc-1',
      duration: 30,
      timePreference: 'any' as const,
    };

    // Availability is shifts-only, so prac-1 works Mon–Fri 09:00–17:00 via
    // weekly shift rows (matching the org business hours these tests assume).
    const PRAC_WEEK_SHIFTS = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
      id: `shift-prac-1-${dayOfWeek}`,
      organizationId: 'org-123',
      practitionerId: 'prac-1',
      locationId: null,
      dayOfWeek,
      date: null,
      startMinutes: 540,
      endMinutes: 1020,
      isOff: false,
      createdAt: new Date(2026, 0, 1),
      updatedAt: new Date(2026, 0, 1),
    }));

    function mockPractitionerSetup() {
      mockDb.query.organization.findFirst.mockResolvedValueOnce(
        orgWithBusinessHours
      );
      mockDb.query.practitionerService.findMany.mockResolvedValueOnce([
        {
          practitioner: {
            id: 'prac-1',
            name: 'Dr Test',
            organizationId: 'org-123',
            isActive: true,
            acceptsBookings: true,
            deletedAt: null,
            workingHours: null,
            locations: [],
          },
        },
      ]);
      setSelectData({ shifts: PRAC_WEEK_SHIFTS });
    }

    it('excludes slots overlapping a one-off practitioner block', async () => {
      mockPractitionerSetup();
      // Blocked time 12:00–13:00 on 2026-06-01, targeted at prac-1.
      setSelectData({
        shifts: PRAC_WEEK_SHIFTS,
        blocked: [
          {
            id: 'block-1',
            organizationId: 'org-123',
            blockedTimeTypeId: null,
            title: 'Lunch',
            description: null,
            startDate: new Date('2026-06-01T12:00:00Z'),
            endDate: new Date('2026-06-01T13:00:00Z'),
            allDay: false,
            timezone: 'UTC',
            rrule: null,
            recurrenceEndDate: null,
            paid: false,
          },
        ],
        blockedJoins: [{ blockedTimeId: 'block-1', practitionerId: 'prac-1' }],
      });

      const result = await checkAvailability(mockDb as never, serviceInput);

      expect(result.success).toBe(true);
      if (!result.success) return;
      // 12:00 and 12:30 slots must not appear; 11:30 and 13:00 should
      const startTimes = result.data.slots.map((s) => s.startTime);
      expect(startTimes).toContain('11:30');
      expect(startTimes).not.toContain('12:00');
      expect(startTimes).not.toContain('12:30');
      expect(startTimes).toContain('13:00');
    });

    it('respects org-wide blocks even when querying by practitioner', async () => {
      mockPractitionerSetup();
      // Org-wide block (zero join rows) 09:00–10:00 — applies to all practitioners.
      setSelectData({
        shifts: PRAC_WEEK_SHIFTS,
        blocked: [
          {
            id: 'org-block',
            organizationId: 'org-123',
            blockedTimeTypeId: null,
            title: 'Public holiday morning',
            description: null,
            startDate: new Date('2026-06-01T09:00:00Z'),
            endDate: new Date('2026-06-01T10:00:00Z'),
            allDay: false,
            timezone: 'UTC',
            rrule: null,
            recurrenceEndDate: null,
            paid: false,
          },
        ],
        blockedJoins: [], // org-wide
      });

      const result = await checkAvailability(mockDb as never, serviceInput);

      expect(result.success).toBe(true);
      if (!result.success) return;
      const startTimes = result.data.slots.map((s) => s.startTime);
      expect(startTimes).not.toContain('09:00');
      expect(startTimes).not.toContain('09:30');
      expect(startTimes).toContain('10:00');
    });
  });

  // ---------------------------------------------------------------------------
  // Practitioner path — working hours, closed days, conflicts & blocks.
  //
  // This is the path the Claire chatbot uses to find bookable slots
  // (offerBookingSlots → checkAvailability with a serviceId). These tests guard
  // the core safety property: the bot must NOT offer a time when the clinic /
  // practitioner is unavailable.
  //
  // Availability is now resolved by `resolveAvailability`: shift rows (falling
  // back to practitionerLocation.workingHours → practitioner.workingHours →
  // org.businessHours when a practitioner has no shifts), minus time off,
  // blocked time and existing appointments.
  // ---------------------------------------------------------------------------
  describe('practitioner path — working hours & availability', () => {
    // 2026-06-01 Mon, 2026-06-06 Sat, 2026-06-07 Sun
    const MON = '2026-06-01';
    const SAT = '2026-06-06';
    const SUN = '2026-06-07';

    type WorkingHours = Record<number, { from: number; to: number } | null>;

    // Mon–Fri 09:00–17:00 (minutes from midnight); weekends closed (null).
    const MON_FRI_9_5: WorkingHours = {
      0: null,
      1: { from: 540, to: 1020 },
      2: { from: 540, to: 1020 },
      3: { from: 540, to: 1020 },
      4: { from: 540, to: 1020 },
      5: { from: 540, to: 1020 },
      6: null,
    };

    function buildOrg(overrides: Record<string, unknown> = {}) {
      return {
        id: 'org-123',
        primaryCalendarType: null,
        primaryCalendarAccountId: null,
        businessHours: MON_FRI_9_5,
        defaultAppointmentDuration: 30,
        ...overrides,
      };
    }

    function buildPractitioner(overrides: Record<string, unknown> = {}) {
      return {
        id: 'prac-1',
        name: 'Dr Test',
        organizationId: 'org-123',
        isActive: true,
        acceptsBookings: true,
        deletedAt: null,
        workingHours: null,
        locations: [],
        ...overrides,
      };
    }

    interface SetupArgs {
      org?: Record<string, unknown>;
      practitioners?: Record<string, unknown>[];
      appointments?: {
        practitionerId: string;
        startDate: Date;
        endDate: Date;
      }[];
      blocked?: Record<string, unknown>[];
      blockedJoins?: { blockedTimeId: string; practitionerId: string }[];
      primaryLocation?: { id: string; openingHours: unknown } | null;
      openingHoursExceptions?: {
        date: string;
        closed: boolean;
        fromMinutes: number | null;
        toMinutes: number | null;
      }[];
    }

    /**
     * Availability is shifts-only. These tests express a practitioner's
     * schedule as a `WorkingHours` map (the natural way to say "Mon–Fri 9–5"),
     * so translate that map into the weekly `shift` rows the resolver actually
     * reads. Effective hours mirror the practitioner's own config
     * (per-location hours → practitioner hours → org business hours) — org/
     * location *opening* hours are deliberately excluded, since they no longer
     * grant availability.
     */
    function shiftsForPractitioner(
      practitioner: Record<string, unknown>,
      org: Record<string, unknown>
    ) {
      const locations =
        (practitioner.locations as
          | { workingHours?: WorkingHours | null }[]
          | undefined) ?? [];
      const effective =
        locations[0]?.workingHours ??
        (practitioner.workingHours as WorkingHours | null) ??
        (org.businessHours as WorkingHours | null) ??
        null;
      if (!effective) return [];
      const rows: Record<string, unknown>[] = [];
      for (const [dayKey, hours] of Object.entries(effective)) {
        if (!hours) continue;
        rows.push({
          id: `shift-${practitioner.id}-${dayKey}`,
          organizationId: org.id,
          practitionerId: practitioner.id,
          locationId: null,
          dayOfWeek: Number(dayKey),
          date: null,
          startMinutes: hours.from,
          endMinutes: hours.to,
          isOff: false,
          createdAt: new Date(2026, 0, 1),
          updatedAt: new Date(2026, 0, 1),
        });
      }
      return rows;
    }

    function setup({
      org = buildOrg(),
      practitioners = [buildPractitioner()],
      appointments = [],
      blocked = [],
      blockedJoins = [],
      primaryLocation = null,
      openingHoursExceptions = [],
    }: SetupArgs = {}) {
      // mockResolvedValue (not ...Once) so tests that call checkAvailability
      // more than once (duration comparison) resolve on every call.
      mockDb.query.organization.findFirst.mockResolvedValue(org);
      mockDb.query.practitionerService.findMany.mockResolvedValue(
        practitioners.map((p) => ({ practitioner: p }))
      );
      // Always reset location mocks so state doesn't leak between tests.
      mockDb.query.organizationLocation.findFirst.mockResolvedValue(
        primaryLocation ?? undefined
      );
      mockDb.query.organizationLocationOpeningHoursException.findMany.mockResolvedValue(
        openingHoursExceptions
      );
      // Availability comes from shift rows derived from each practitioner's
      // working-hours schedule.
      const shifts = practitioners.flatMap((p) =>
        shiftsForPractitioner(p, org)
      );
      setSelectData({ shifts, appointments, blocked, blockedJoins });
    }

    function input(date: string, extra: Record<string, unknown> = {}) {
      return {
        organizationId: 'org-123',
        date,
        serviceId: 'svc-1',
        duration: 30,
        timePreference: 'any' as const,
        ...extra,
      };
    }

    function startTimesOf(
      result: Awaited<ReturnType<typeof checkAvailability>>
    ): string[] {
      if (!result.success) throw new Error('expected success');
      return result.data.slots.map((s) => s.startTime);
    }

    // --- Closed days -------------------------------------------------------

    it('offers NO slots on a Sunday (clinic closed that weekday)', async () => {
      setup();
      const result = await checkAvailability(mockDb as never, input(SUN));

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.slots).toHaveLength(0);
      expect(result.data.available).toBe(false);
      expect(result.data.message.toLowerCase()).toContain('sorry');
    });

    it('offers NO slots on a Saturday even though it is the current calendar day', async () => {
      // Regression for the reported bug: the bookings calendar showed Saturday
      // as fully blocked because org.businessHours has no day 6. The bot must
      // agree and offer nothing on that day.
      setup();
      const result = await checkAvailability(mockDb as never, input(SAT));

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.slots).toHaveLength(0);
      expect(result.data.available).toBe(false);
    });

    it('offers slots on an open weekday', async () => {
      setup();
      const result = await checkAvailability(mockDb as never, input(MON));

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.available).toBe(true);
      expect(result.data.slots.length).toBeGreaterThan(0);
    });

    // --- Working-hours bounds ---------------------------------------------

    it('confines slots to business hours (first 09:00, last 16:30 for 30-min)', async () => {
      setup();
      const result = await checkAvailability(mockDb as never, input(MON));
      const starts = startTimesOf(result);

      expect(starts[0]).toBe('09:00');
      expect(starts).toContain('16:30');
      expect(starts).not.toContain('08:30');
      expect(starts).not.toContain('08:00');
      expect(starts).not.toContain('17:00');
    });

    it('never offers a slot that would run past closing time', async () => {
      setup();
      // 60-minute service: the last slot that fits before 17:00 starts 16:00.
      const result = await checkAvailability(
        mockDb as never,
        input(MON, { duration: 60 })
      );
      const starts = startTimesOf(result);

      expect(starts).toContain('16:00');
      expect(starts).not.toContain('16:30'); // 16:30 + 60m = 17:30 > 17:00
    });

    it('honours the morning time preference', async () => {
      setup();
      const result = await checkAvailability(
        mockDb as never,
        input(MON, { timePreference: 'morning' })
      );
      const starts = startTimesOf(result);

      expect(starts).toContain('09:00');
      expect(starts).toContain('11:30');
      expect(starts).not.toContain('12:00');
      expect(starts).not.toContain('13:00');
    });

    it('honours the afternoon time preference', async () => {
      setup();
      const result = await checkAvailability(
        mockDb as never,
        input(MON, { timePreference: 'afternoon' })
      );
      const starts = startTimesOf(result);

      expect(starts).toContain('12:00');
      expect(starts).toContain('16:30');
      expect(starts).not.toContain('11:30');
      expect(starts).not.toContain('09:00');
    });

    // --- Working-hours source precedence ----------------------------------

    it('uses practitioner-location working hours over org business hours', async () => {
      setup({
        practitioners: [
          buildPractitioner({
            workingHours: null,
            // Location-level: Monday 10:00–11:00 only.
            locations: [{ workingHours: { 1: { from: 600, to: 660 } } }],
          }),
        ],
      });
      const result = await checkAvailability(mockDb as never, input(MON));
      const starts = startTimesOf(result);

      expect(starts).toContain('10:00');
      expect(starts).toContain('10:30');
      expect(starts).not.toContain('09:00'); // org hours would have allowed this
      expect(starts).not.toContain('11:00');
    });

    it('uses practitioner working hours over org business hours when no location', async () => {
      setup({
        practitioners: [
          buildPractitioner({
            // Practitioner-level: Monday 08:00–09:00 only.
            workingHours: { 1: { from: 480, to: 540 } },
            locations: [],
          }),
        ],
      });
      const result = await checkAvailability(mockDb as never, input(MON));
      const starts = startTimesOf(result);

      expect(starts).toContain('08:00');
      expect(starts).toContain('08:30');
      expect(starts).not.toContain('09:00'); // org hours would have allowed this
    });

    it('offers nothing when no working hours are configured anywhere', async () => {
      setup({
        org: buildOrg({ businessHours: null }),
        practitioners: [
          buildPractitioner({ workingHours: null, locations: [] }),
        ],
      });
      const result = await checkAvailability(mockDb as never, input(MON));

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.slots).toHaveLength(0);
      expect(result.data.available).toBe(false);
    });

    it('offers nothing for a practitioner who has switched off Calendar bookings', async () => {
      // The team-member editor's "Calendar bookings" toggle was written and
      // never read: the bot went on offering — and booking — someone who had
      // opted out of taking appointments.
      setup({
        practitioners: [buildPractitioner({ acceptsBookings: false })],
      });
      const result = await checkAvailability(mockDb as never, input(MON));

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.slots).toHaveLength(0);
      expect(result.data.available).toBe(false);
    });

    // --- Existing appointment conflicts -----------------------------------

    it('excludes a slot already taken by a scheduled appointment', async () => {
      setup({
        appointments: [
          {
            practitionerId: 'prac-1',
            startDate: new Date(`${MON}T10:00:00Z`),
            endDate: new Date(`${MON}T10:30:00Z`),
          },
        ],
      });
      const result = await checkAvailability(mockDb as never, input(MON));
      const starts = startTimesOf(result);

      expect(starts).not.toContain('10:00');
      expect(starts).toContain('09:30');
      expect(starts).toContain('10:30');
    });

    it('windows the org-tz day for a non-UTC org (early-local conflict excluded, no adjacent-day leak)', async () => {
      // Org in America/New_York (UTC-4 in June). Working 09:00–17:00 EDT
      // = 13:00–21:00Z. An early-local appointment at 09:00 EDT (13:00Z) must
      // be excluded, and slots must be labelled + confined to the EDT day.
      setup({
        org: buildOrg({ timezone: 'America/New_York' }),
        appointments: [
          {
            practitionerId: 'prac-1',
            startDate: new Date(`${MON}T13:00:00Z`), // 09:00 EDT
            endDate: new Date(`${MON}T13:30:00Z`), // 09:30 EDT
          },
        ],
      });
      const result = await checkAvailability(mockDb as never, input(MON));
      const starts = startTimesOf(result);

      // Slots labelled in EDT. The 09:00 EDT slot is taken by the appointment,
      // so the first available slot is 09:30; the day still ends at 16:30.
      expect(starts).not.toContain('09:00');
      expect(starts[0]).toBe('09:30');
      expect(starts).toContain('16:30');
      // No adjacent-day leak: every offered slot is on the requested EDT date.
      if (result.success) {
        expect(result.data.slots.every((s) => s.date === MON)).toBe(true);
        // A leaked Tuesday would duplicate wall-clock labels; ensure uniqueness.
        const labels = result.data.slots.map((s) => s.startTime);
        expect(new Set(labels).size).toBe(labels.length);
      }
    });

    it('excludes every slot overlapping a longer appointment', async () => {
      setup({
        appointments: [
          {
            practitionerId: 'prac-1',
            startDate: new Date(`${MON}T10:00:00Z`),
            endDate: new Date(`${MON}T11:00:00Z`),
          },
        ],
      });
      const result = await checkAvailability(mockDb as never, input(MON));
      const starts = startTimesOf(result);

      expect(starts).not.toContain('10:00');
      expect(starts).not.toContain('10:30');
      expect(starts).toContain('09:30');
      expect(starts).toContain('11:00');
    });

    // --- Blocked time -----------------------------------------------------

    it('offers nothing when a block spans the entire working day', async () => {
      setup({
        blocked: [
          {
            id: 'block-full',
            organizationId: 'org-123',
            blockedTimeTypeId: null,
            title: 'Closed — training day',
            description: null,
            startDate: new Date(`${MON}T09:00:00Z`),
            endDate: new Date(`${MON}T17:00:00Z`),
            allDay: false,
            timezone: 'UTC',
            rrule: null,
            recurrenceEndDate: null,
            paid: false,
          },
        ],
        blockedJoins: [
          { blockedTimeId: 'block-full', practitionerId: 'prac-1' },
        ],
      });
      const result = await checkAvailability(mockDb as never, input(MON));

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.slots).toHaveLength(0);
      expect(result.data.available).toBe(false);
    });

    // --- Practitioner filtering -------------------------------------------

    it('returns a "no practitioners" message when the service has none assigned', async () => {
      setup({ practitioners: [] });
      const result = await checkAvailability(mockDb as never, input(MON));

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.slots).toHaveLength(0);
      expect(result.data.available).toBe(false);
      expect(result.data.message).toMatch(/no practitioners/i);
    });

    it('ignores inactive practitioners', async () => {
      setup({ practitioners: [buildPractitioner({ isActive: false })] });
      const result = await checkAvailability(mockDb as never, input(MON));

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.available).toBe(false);
      expect(result.data.message).toMatch(/no practitioners/i);
    });

    it('ignores practitioners belonging to another organization', async () => {
      setup({
        practitioners: [buildPractitioner({ organizationId: 'other-org' })],
      });
      const result = await checkAvailability(mockDb as never, input(MON));

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.available).toBe(false);
      expect(result.data.message).toMatch(/no practitioners/i);
    });

    // --- Multiple practitioners -------------------------------------------

    it('merges and de-duplicates identical slot times across practitioners', async () => {
      setup({
        practitioners: [
          buildPractitioner({ id: 'prac-1', name: 'Dr A' }),
          buildPractitioner({ id: 'prac-2', name: 'Dr B' }),
        ],
      });
      const result = await checkAvailability(mockDb as never, input(MON));

      expect(result.success).toBe(true);
      if (!result.success) return;
      const isoStarts = result.data.slots.map((s) => s.isoStart);
      // Both practitioners are free 09:00–17:00 → identical times must collapse.
      expect(new Set(isoStarts).size).toBe(isoStarts.length);
      expect(result.data.slots.length).toBeGreaterThan(0);
      expect(result.data.available).toBe(true);
    });

    // --- Duration ----------------------------------------------------------

    it('offers fewer slots for a longer appointment duration', async () => {
      setup();
      const short = await checkAvailability(
        mockDb as never,
        input(MON, { duration: 30 })
      );
      const long = await checkAvailability(
        mockDb as never,
        input(MON, { duration: 120 })
      );

      expect(short.success && long.success).toBe(true);
      if (!short.success || !long.success) return;
      expect(long.data.slots.length).toBeGreaterThan(0);
      expect(long.data.slots.length).toBeLessThan(short.data.slots.length);
    });

    // --- Opening hours are display-only, never a booking gate --------------
    // Availability is shifts-only. Org/location opening hours and their per-date
    // exceptions are informational (booking page + chatbot phrasing); they must
    // NOT add, remove, or clamp bookable slots. Closing a specific day is done
    // with a shift day-off override, not an opening-hours exception.

    it('IGNORES a one-off opening-hours EXCEPTION that would close a normally-open day', async () => {
      // The practitioner is on shift Mon 09:00–17:00. A "closed" opening-hours
      // exception is display-only and must not remove that availability.
      setup({
        primaryLocation: { id: 'loc-1', openingHours: null },
        openingHoursExceptions: [
          { date: MON, closed: true, fromMinutes: null, toMinutes: null },
        ],
      });
      const result = await checkAvailability(mockDb as never, input(MON));

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.slots.length).toBeGreaterThan(0);
      expect(result.data.available).toBe(true);
    });

    it('IGNORES organizationLocation.openingHours — shifts alone decide availability', async () => {
      // Location opening hours say 10:00–11:00, but the practitioner's shift is
      // 09:00–17:00 (from org business hours). Opening hours must not clamp it.
      setup({
        primaryLocation: {
          id: 'loc-1',
          openingHours: { 1: { from: 600, to: 660 } },
        },
      });
      const result = await checkAvailability(mockDb as never, input(MON));
      const starts = startTimesOf(result);

      expect(starts).toContain('09:00');
      expect(starts).toContain('11:00');
    });
  });

  describe('Timely - account not found', () => {
    it('returns NOT_FOUND when booking account does not exist', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        primaryCalendarType: 'timely',
        primaryCalendarAccountId: 'booking-123',
      });
      mockDb.query.bookingAccount.findFirst.mockResolvedValueOnce(null);

      const result = await checkAvailability(mockDb as never, validInput);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(result.error.message).toContain('Timely account not found');
      }
    });
  });
  // ---------------------------------------------------------------------------
  // Resource gate (treatment rooms / equipment).
  //
  // The voice agent and Claire both quote times from this path. A free
  // practitioner is only half the answer: three practitioners and two rooms can
  // run two treatments at 14:00, not three.
  // ---------------------------------------------------------------------------
  describe('practitioner path — resource gate', () => {
    // 2026-06-01 is a Monday; prac-1 works Mon–Fri 09:00–17:00 via shift rows.
    const MONDAY = '2026-06-01';
    const RESOURCE_SHIFTS = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
      id: `shift-res-${dayOfWeek}`,
      organizationId: 'org-123',
      practitionerId: 'prac-1',
      locationId: null,
      dayOfWeek,
      date: null,
      startMinutes: 540,
      endMinutes: 1020,
      isOff: false,
      createdAt: new Date(2026, 0, 1),
      updatedAt: new Date(2026, 0, 1),
    }));

    const serviceInput = {
      organizationId: 'org-123',
      date: MONDAY,
      serviceId: 'svc-1',
      duration: 30,
      timezone: 'UTC',
      timePreference: 'any' as const,
    };

    function setupPractitioner() {
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        id: 'org-123',
        primaryCalendarType: null,
        primaryCalendarAccountId: null,
        businessHours: null,
        defaultAppointmentDuration: 30,
        timezone: 'UTC',
      });
      mockDb.query.practitionerService.findMany.mockResolvedValueOnce([
        {
          practitioner: {
            id: 'prac-1',
            name: 'Dr Test',
            organizationId: 'org-123',
            isActive: true,
            acceptsBookings: true,
            deletedAt: null,
            workingHours: null,
            locations: [],
          },
        },
      ]);
      setSelectData({ shifts: RESOURCE_SHIFTS });
    }

    async function startTimes(input = serviceInput) {
      setupPractitioner();
      const result = await checkAvailability(mockDb as never, input);
      expect(result.success).toBe(true);
      if (!result.success) return [];
      return result.data.slots.map((s) => s.startTime);
    }

    it('returns the identical slot list when no service has requirements', async () => {
      // THE rollout-safety guard. Every existing org is in this state: the
      // loader finds no requirement row, returns null, and the day is exactly
      // what it was before resources existed.
      const ungated = await startTimes();

      loadResourceGateContext.mockResolvedValueOnce(null);
      const gated = await startTimes();

      expect(gated).toEqual(ungated);
      expect(gated).toContain('09:00');
    });

    it('does not even look for requirements when there is no service', async () => {
      // No serviceId = no cart = nothing that could require a room. The org
      // still needs practitioners resolved, so this exercises the whole path.
      setupPractitioner();
      await checkAvailability(mockDb as never, {
        organizationId: 'org-123',
        date: MONDAY,
        duration: 30,
        timezone: 'UTC',
        timePreference: 'any' as const,
      });

      expect(loadResourceGateContext).not.toHaveBeenCalled();
    });

    it('keeps a slot whose only eligible room is free', async () => {
      loadResourceGateContext.mockResolvedValueOnce(roomContext([]));

      expect(await startTimes()).toContain('09:00');
    });

    it('drops a slot whose only eligible room is already taken', async () => {
      // Room busy 09:00–10:00. The practitioner is on shift the whole morning,
      // so without the gate the bot would quote 09:00 and 09:30 anyway.
      loadResourceGateContext.mockResolvedValueOnce(
        roomContext([
          {
            start: new Date('2026-06-01T09:00:00Z'),
            end: new Date('2026-06-01T10:00:00Z'),
          },
        ])
      );

      const starts = await startTimes();

      expect(starts).not.toContain('09:00');
      expect(starts).not.toContain('09:30');
      expect(starts).toContain('10:00');
    });

    it('drops the slot when ONE of two required categories cannot be satisfied', async () => {
      // A laser facial needs a room AND the laser. The room is free all day;
      // the laser has no working intervals at all, so the whole day goes.
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
            { resourceId: 'laser-1', capacity: 1, working: [], busy: [] },
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

      expect(await startTimes()).toEqual([]);
    });

    it('loads the gate context ONCE for a whole multi-slot day', async () => {
      // Pins the N+1 rule: the context spans [dayStart, dayEnd) and every
      // per-slot test against it is in-memory. One call for all 16 slots.
      loadResourceGateContext.mockResolvedValueOnce(roomContext([]));

      const starts = await startTimes();

      expect(starts.length).toBeGreaterThan(1);
      expect(loadResourceGateContext).toHaveBeenCalledTimes(1);
    });

    it('passes the cart, the org time zone and the day window through', async () => {
      loadResourceGateContext.mockResolvedValueOnce(null);
      await startTimes();

      expect(loadResourceGateContext).toHaveBeenCalledTimes(1);
      const arg = loadResourceGateContext.mock.calls[0][1] as {
        organizationId: string;
        serviceIds: string[];
        from: Date;
        to: Date;
        timeZone: string;
        locationId: string | null;
      };
      expect(arg.organizationId).toBe('org-123');
      expect(arg.serviceIds).toEqual(['svc-1']);
      // Never assumed UTC — resource working hours are wall-clock in this zone.
      expect(arg.timeZone).toBe('UTC');
      expect(arg.from.toISOString()).toBe('2026-06-01T00:00:00.000Z');
      expect(arg.to.toISOString()).toBe('2026-06-02T00:00:00.000Z');
    });
  });
});
