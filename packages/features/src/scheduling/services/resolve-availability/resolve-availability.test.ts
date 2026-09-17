import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import {
  generateSlots,
  resolveAvailability,
} from './resolve-availability.service.js';

// 2026-07-06 is a Monday.
const monday = new Date(2026, 6, 6);
const from = new Date(2026, 6, 6, 0, 0, 0, 0);
const to = new Date(2026, 6, 6, 23, 59, 59, 0);
const pastNow = new Date(2020, 0, 1);

const weeklyMonday = {
  id: 's_w1',
  organizationId: 'org_1',
  practitionerId: 'prac_1',
  locationId: null,
  dayOfWeek: 1,
  date: null,
  startMinutes: 540, // 09:00
  endMinutes: 1020, // 17:00
  isOff: false,
  createdAt: monday,
  updatedAt: monday,
};

const baseInput = {
  organizationId: 'org_1',
  practitionerIds: ['prac_1'],
  from,
  to,
  timeZone: 'UTC',
  orgBusinessHours: null,
};

describe('resolveAvailability', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // _resetMocks only clears call history, not the mockResolvedValueOnce
    // queue — reset the chain terminal so leaked onces don't shift later tests.
    mockDb.where.mockReset();
    mockDb.where.mockReturnThis();
  });

  /** Queue the four sequential .where() results: shifts, timeOff, blocked, appts. */
  function queueWheres(opts: {
    shifts?: unknown[];
    timeOff?: unknown[];
    blocked?: unknown[];
    appointments?: unknown[];
  }) {
    mockDb.where
      .mockResolvedValueOnce(opts.shifts ?? [])
      .mockResolvedValueOnce(opts.timeOff ?? [])
      .mockResolvedValueOnce(opts.blocked ?? [])
      .mockResolvedValueOnce(opts.appointments ?? []);
  }

  it('resolves weekly shift into working intervals with no busy', async () => {
    queueWheres({ shifts: [weeklyMonday] });

    const [avail] = await resolveAvailability(mockDb as never, baseInput);

    expect(avail.practitionerId).toBe('prac_1');
    expect(avail.working).toHaveLength(1);
    expect(avail.working[0].start).toEqual(
      new Date(Date.UTC(2026, 6, 6, 9, 0))
    );
    expect(avail.working[0].end).toEqual(new Date(Date.UTC(2026, 6, 6, 17, 0)));
    expect(avail.busy).toHaveLength(0);

    const slots = generateSlots(avail, 60, { now: pastNow });
    // 09:00..16:00 at 30-min steps that fit a 60-min slot = 15 slots.
    expect(slots).toHaveLength(15);
    expect(slots[0].start).toEqual(new Date(Date.UTC(2026, 6, 6, 9, 0)));
  });

  it('emits no working intervals on an isOff override day', async () => {
    const offOverride = {
      ...weeklyMonday,
      id: 's_o1',
      dayOfWeek: null,
      date: '2026-07-06',
      startMinutes: null,
      endMinutes: null,
      isOff: true,
    };
    queueWheres({ shifts: [weeklyMonday, offOverride] });

    const [avail] = await resolveAvailability(mockDb as never, baseInput);
    expect(avail.working).toHaveLength(0);
    expect(generateSlots(avail, 60, { now: pastNow })).toHaveLength(0);
  });

  it('subtracts an existing appointment from available slots', async () => {
    queueWheres({
      shifts: [weeklyMonday],
      appointments: [
        {
          practitionerId: 'prac_1',
          startDate: new Date(Date.UTC(2026, 6, 6, 10, 0)),
          endDate: new Date(Date.UTC(2026, 6, 6, 11, 0)),
        },
      ],
    });

    const [avail] = await resolveAvailability(mockDb as never, baseInput);
    const slots = generateSlots(avail, 60, { now: pastNow });

    // No slot may overlap 10:00–11:00.
    const overlaps = slots.some(
      (s) =>
        s.start < new Date(Date.UTC(2026, 6, 6, 11, 0)) &&
        s.end > new Date(Date.UTC(2026, 6, 6, 10, 0))
    );
    expect(overlaps).toBe(false);
    // 9:30 and 10:00 and 10:30 candidates are gone; 9:00 stays, 11:00 stays.
    expect(
      slots.some((s) => s.start.getTime() === Date.UTC(2026, 6, 6, 9, 0))
    ).toBe(true);
    expect(
      slots.some((s) => s.start.getTime() === Date.UTC(2026, 6, 6, 11, 0))
    ).toBe(true);
  });

  it('subtracts an org-wide blocked-time block (zero join rows)', async () => {
    // blocked series non-empty → 6 sequential .where() calls:
    // shifts, timeOff, blocked series, joins, exceptions, appointments.
    mockDb.where
      .mockResolvedValueOnce([weeklyMonday]) // shifts
      .mockResolvedValueOnce([]) // timeOff
      .mockResolvedValueOnce([
        {
          id: 'bt_1',
          organizationId: 'org_1',
          blockedTimeTypeId: null,
          title: 'Lunch',
          description: null,
          startDate: new Date(Date.UTC(2026, 6, 6, 13, 0)),
          endDate: new Date(Date.UTC(2026, 6, 6, 14, 0)),
          allDay: false,
          timezone: 'UTC',
          rrule: null,
          recurrenceEndDate: null,
          paid: false,
          createdById: 'u_1',
          createdAt: monday,
          updatedAt: monday,
        },
      ]) // blocked series
      .mockResolvedValueOnce([]) // blockedTimePractitioner joins (org-wide)
      .mockResolvedValueOnce([]) // blockedTimeException
      .mockResolvedValueOnce([]); // appointments

    const [avail] = await resolveAvailability(mockDb as never, baseInput);
    const slots = generateSlots(avail, 60, { now: pastNow });
    const overlapsLunch = slots.some(
      (s) =>
        s.start < new Date(Date.UTC(2026, 6, 6, 14, 0)) &&
        s.end > new Date(Date.UTC(2026, 6, 6, 13, 0))
    );
    expect(overlapsLunch).toBe(false);
  });

  it('has NO working intervals when the practitioner has no shift rows (org business hours are ignored)', async () => {
    queueWheres({ shifts: [] });

    const [avail] = await resolveAvailability(mockDb as never, {
      ...baseInput,
      // Org business hours are informational only and must NOT create
      // availability for a practitioner with no shifts.
      orgBusinessHours: { 1: { from: 600, to: 720 } }, // Mon 10:00–12:00
    });

    expect(avail.working).toHaveLength(0);
    expect(generateSlots(avail, 60, { now: pastNow })).toHaveLength(0);
  });

  it('ignores a "closed" opening-hours exception — the shift stays bookable', async () => {
    queueWheres({ shifts: [weeklyMonday] });

    const [avail] = await resolveAvailability(mockDb as never, {
      ...baseInput,
      // Opening-hours exceptions are display-only; they no longer close a day.
      openingHoursExceptions: [
        {
          date: '2026-07-06',
          closed: true,
          fromMinutes: null,
          toMinutes: null,
        },
      ],
    });

    expect(avail.working).toHaveLength(1);
    expect(avail.working[0].start).toEqual(
      new Date(Date.UTC(2026, 6, 6, 9, 0))
    );
    expect(avail.working[0].end).toEqual(new Date(Date.UTC(2026, 6, 6, 17, 0)));
  });

  it('ignores an opening-hours exception with custom hours — the full shift stands', async () => {
    queueWheres({ shifts: [weeklyMonday] });

    // Shift is 09:00–17:00; a 12:00–15:00 exception must NOT clamp it.
    const [avail] = await resolveAvailability(mockDb as never, {
      ...baseInput,
      openingHoursExceptions: [
        { date: '2026-07-06', closed: false, fromMinutes: 720, toMinutes: 900 },
      ],
    });

    expect(avail.working).toHaveLength(1);
    expect(avail.working[0].start).toEqual(
      new Date(Date.UTC(2026, 6, 6, 9, 0))
    );
    expect(avail.working[0].end).toEqual(new Date(Date.UTC(2026, 6, 6, 17, 0)));
  });

  it('ignores location opening hours — no shifts means not available', async () => {
    queueWheres({ shifts: [] });

    const [avail] = await resolveAvailability(mockDb as never, {
      ...baseInput,
      locationOpeningHours: { 1: { from: 600, to: 660 } }, // Mon 10:00–11:00
      orgBusinessHours: { 1: { from: 540, to: 1020 } }, // 09:00–17:00
    });

    expect(avail.working).toHaveLength(0);
  });

  it('does NOT fall back when practitioner has shift rows (shift is authoritative)', async () => {
    // Weekly Tuesday only; window is a Monday → not working, and must NOT fall
    // back to businessHours for Monday.
    const weeklyTuesday = { ...weeklyMonday, id: 's_w2', dayOfWeek: 2 };
    queueWheres({ shifts: [weeklyTuesday] });

    const [avail] = await resolveAvailability(mockDb as never, {
      ...baseInput,
      orgBusinessHours: { 1: { from: 600, to: 720 } },
    });
    expect(avail.working).toHaveLength(0);
  });
});
