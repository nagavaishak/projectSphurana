import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { createRunAutoClockDeps } from './run-auto-clock.service.js';

describe('createRunAutoClockDeps', () => {
  const mockDb = createMockDatabase();
  const deps = createRunAutoClockDeps(mockDb as never);

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  describe('getWageAutomationConfig', () => {
    it('returns the automation flag slice when a wage config row exists', async () => {
      mockDb.query.practitionerWageConfig.findFirst.mockResolvedValueOnce({
        practitionerId: 'prac_1',
        organizationId: 'org_1',
        autoClockIn: 'enabled',
        autoClockOut: 'workspace_default',
        automatedBreaks: 'disabled',
        // other columns present on the row are ignored by the slice
        compensationType: 'hourly',
      });

      const result = await deps.getWageAutomationConfig({
        organizationId: 'org_1',
        practitionerId: 'prac_1',
      });

      expect(result).toEqual({
        autoClockIn: 'enabled',
        autoClockOut: 'workspace_default',
        automatedBreaks: 'disabled',
      });
    });

    it('returns null when the practitioner has no wage config row', async () => {
      mockDb.query.practitionerWageConfig.findFirst.mockResolvedValueOnce(null);

      const result = await deps.getWageAutomationConfig({
        organizationId: 'org_1',
        practitionerId: 'prac_1',
      });

      expect(result).toBeNull();
    });
  });

  describe('getOrgWageDefaults', () => {
    it('maps the resolved org_defaults wage booleans (null column → false)', async () => {
      mockDb.query.orgDefaults.findFirst.mockResolvedValueOnce({
        organizationId: 'org_1',
        wageAutoClockIn: true,
        wageAutoClockOut: null,
        wageAutomatedBreaks: false,
      });

      const result = await deps.getOrgWageDefaults({ organizationId: 'org_1' });

      expect(result).toEqual({
        wageAutoClockIn: true,
        wageAutoClockOut: false,
        wageAutomatedBreaks: false,
      });
    });

    it('falls back to false when no org_defaults row exists', async () => {
      mockDb.query.orgDefaults.findFirst.mockResolvedValueOnce(null);

      const result = await deps.getOrgWageDefaults({ organizationId: 'org_1' });

      expect(result).toEqual({
        wageAutoClockIn: false,
        wageAutoClockOut: false,
        wageAutomatedBreaks: false,
      });
    });
  });

  describe('getShiftWindows', () => {
    it('resolves shift rows into absolute UTC instants (org tz = UTC)', async () => {
      // No org row → timezone falls back to UTC.
      mockDb.query.organization.findFirst.mockResolvedValueOnce(null);
      // 2026-07-06 is a Monday (dayOfWeek=1); 540..1020 = 09:00..17:00.
      mockDb.where.mockResolvedValueOnce([
        {
          id: 's_1',
          organizationId: 'org_1',
          practitionerId: 'prac_1',
          locationId: null,
          dayOfWeek: 1,
          date: null,
          startMinutes: 540,
          endMinutes: 1020,
          isOff: false,
        },
      ]);

      const now = new Date('2026-07-06T10:00:00Z'); // Monday 10:00 UTC
      const windows = await deps.getShiftWindows({
        organizationId: 'org_1',
        practitionerId: 'prac_1',
        now,
      });

      expect(windows).toHaveLength(1);
      // 09:00 → 17:00 resolved in the org's timezone (UTC here).
      expect(windows[0].start.toISOString()).toBe('2026-07-06T09:00:00.000Z');
      expect(windows[0].end.toISOString()).toBe('2026-07-06T17:00:00.000Z');
    });

    it('anchors shift minutes to the org IANA timezone, not the server zone', async () => {
      // Europe/Dublin on 2026-07-06 is IST (UTC+1); 09:00 wall → 08:00Z.
      mockDb.query.organization.findFirst.mockResolvedValueOnce({
        timezone: 'Europe/Dublin',
      });
      mockDb.where.mockResolvedValueOnce([
        {
          id: 's_dub',
          organizationId: 'org_1',
          practitionerId: 'prac_1',
          locationId: null,
          dayOfWeek: 1,
          date: null,
          startMinutes: 540,
          endMinutes: 1020,
          isOff: false,
        },
      ]);

      const now = new Date('2026-07-06T10:00:00Z');
      const windows = await deps.getShiftWindows({
        organizationId: 'org_1',
        practitionerId: 'prac_1',
        now,
      });

      expect(windows).toHaveLength(1);
      expect(windows[0].start.toISOString()).toBe('2026-07-06T08:00:00.000Z');
      expect(windows[0].end.toISOString()).toBe('2026-07-06T16:00:00.000Z');
    });

    it('includes the prior local day so an overnight ending window is visible', async () => {
      // A shift ending on the day BEFORE `now` must still surface so a
      // still-open entry can auto-close. Sunday 2026-07-05 (dayOfWeek=0).
      mockDb.query.organization.findFirst.mockResolvedValueOnce(null);
      mockDb.where.mockResolvedValueOnce([
        {
          id: 's_prev',
          organizationId: 'org_1',
          practitionerId: 'prac_1',
          locationId: null,
          dayOfWeek: 0,
          date: null,
          startMinutes: 540,
          endMinutes: 1020,
          isOff: false,
        },
      ]);

      // now is Monday 00:30Z — the previous day's window would be missed by a
      // {from: now, to: now} query.
      const now = new Date('2026-07-06T00:30:00Z');
      const windows = await deps.getShiftWindows({
        organizationId: 'org_1',
        practitionerId: 'prac_1',
        now,
      });

      expect(windows).toHaveLength(1);
      expect(windows[0].end.toISOString()).toBe('2026-07-05T17:00:00.000Z');
    });

    it('emits no windows on an is_off override day', async () => {
      mockDb.query.organization.findFirst.mockResolvedValueOnce(null);
      mockDb.where.mockResolvedValueOnce([
        {
          id: 's_off',
          organizationId: 'org_1',
          practitionerId: 'prac_1',
          locationId: null,
          dayOfWeek: null,
          date: '2026-07-06',
          startMinutes: null,
          endMinutes: null,
          isOff: true,
        },
      ]);

      const now = new Date(2026, 6, 6, 10, 0);
      const windows = await deps.getShiftWindows({
        organizationId: 'org_1',
        practitionerId: 'prac_1',
        now,
      });

      expect(windows).toEqual([]);
    });
  });

  describe('getUnpaidBlockedTimeOccurrences', () => {
    const from = new Date('2026-07-06T00:00:00Z');
    const to = new Date('2026-07-06T23:59:59Z');

    const makeSeries = (paid: boolean) => ({
      id: 'bt_1',
      organizationId: 'org_1',
      blockedTimeTypeId: null,
      title: 'Lunch',
      description: null,
      startDate: new Date('2026-07-06T12:00:00Z'),
      endDate: new Date('2026-07-06T12:30:00Z'),
      allDay: false,
      timezone: 'UTC',
      rrule: null,
      recurrenceEndDate: null,
      paid,
      createdById: 'user_1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    it('returns only unpaid expanded occurrences within the window', async () => {
      // listBlockedTime: series → joins → exceptions (org-wide: no joins).
      mockDb.where
        .mockResolvedValueOnce([makeSeries(false)])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await deps.getUnpaidBlockedTimeOccurrences({
        organizationId: 'org_1',
        practitionerId: 'prac_1',
        from,
        to,
      });

      expect(result).toEqual([
        {
          start: new Date('2026-07-06T12:00:00Z'),
          end: new Date('2026-07-06T12:30:00Z'),
          paid: false,
        },
      ]);
    });

    it('drops paid blocked-time occurrences (not a break signal)', async () => {
      mockDb.where
        .mockResolvedValueOnce([makeSeries(true)])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await deps.getUnpaidBlockedTimeOccurrences({
        organizationId: 'org_1',
        practitionerId: 'prac_1',
        from,
        to,
      });

      expect(result).toEqual([]);
    });
  });
});
