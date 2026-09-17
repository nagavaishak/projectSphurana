import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import type { RunAutoClockDeps } from './run-auto-clock.service.js';
import { runAutoClock } from './run-auto-clock.service.js';

const d = (iso: string) => new Date(iso);

describe('runAutoClock', () => {
  const mockDb = createMockDatabase();

  const makeDeps = (
    overrides: Partial<RunAutoClockDeps> = {}
  ): RunAutoClockDeps => ({
    getWageAutomationConfig: vi.fn().mockResolvedValue({
      autoClockIn: 'enabled',
      autoClockOut: 'enabled',
      automatedBreaks: 'enabled',
    }),
    getOrgWageDefaults: vi.fn().mockResolvedValue(null),
    getShiftWindows: vi
      .fn()
      .mockResolvedValue([
        { start: d('2026-07-06T09:00:00Z'), end: d('2026-07-06T17:00:00Z') },
      ]),
    getUnpaidBlockedTimeOccurrences: vi.fn().mockResolvedValue([]),
    ...overrides,
  });

  const input = {
    organizationId: 'org_123',
    practitionerId: 'prac_123',
    now: d('2026-07-06T09:05:00Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('no-ops without touching shifts when both clock flags resolve off', async () => {
    const deps = makeDeps({
      getWageAutomationConfig: vi.fn().mockResolvedValue({
        autoClockIn: 'disabled',
        autoClockOut: 'workspace_default',
        automatedBreaks: 'enabled',
      }),
    });

    const result = await runAutoClock(mockDb as never, input, deps);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        clockedIn: null,
        clockedOut: null,
        autoBreaksInserted: 0,
      });
    }
    expect(deps.getShiftWindows).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('auto clocks in at shift start with source auto', async () => {
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce(null);
    const created = {
      id: 'te_new',
      clockIn: d('2026-07-06T09:00:00Z'),
      source: 'auto',
      status: 'open',
    };
    mockDb.returning.mockResolvedValueOnce([created]);

    const result = await runAutoClock(mockDb as never, input, makeDeps());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clockedIn).toEqual(created);
      expect(result.data.clockedOut).toBeNull();
    }
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        clockIn: d('2026-07-06T09:00:00Z'),
        source: 'auto',
        status: 'open',
      })
    );
  });

  it('auto clocks out at shift end and inserts derived unpaid breaks', async () => {
    const openEntry = {
      id: 'te_1',
      clockIn: d('2026-07-06T09:00:00Z'),
      clockOut: null,
    };
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce(openEntry);
    const closed = {
      ...openEntry,
      clockOut: d('2026-07-06T17:00:00Z'),
      status: 'completed',
    };
    // 1st returning: the update; 2nd returning: inserted breaks
    mockDb.returning
      .mockResolvedValueOnce([closed])
      .mockResolvedValueOnce([{ id: 'br_1' }]);

    const deps = makeDeps({
      getUnpaidBlockedTimeOccurrences: vi.fn().mockResolvedValue([
        {
          start: d('2026-07-06T12:00:00Z'),
          end: d('2026-07-06T12:30:00Z'),
          paid: false,
        },
      ]),
    });

    const result = await runAutoClock(
      mockDb as never,
      { ...input, now: d('2026-07-06T17:03:00Z') },
      deps
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clockedOut).toEqual(closed);
      expect(result.data.autoBreaksInserted).toBe(1);
      expect(result.data.clockedIn).toBeNull();
    }
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        clockOut: d('2026-07-06T17:00:00Z'),
        status: 'completed',
      })
    );
    expect(mockDb.values).toHaveBeenCalledWith([
      expect.objectContaining({
        timeEntryId: 'te_1',
        breakStart: d('2026-07-06T12:00:00Z'),
        breakEnd: d('2026-07-06T12:30:00Z'),
        source: 'auto',
      }),
    ]);
  });

  it('skips automated breaks when the flag resolves off', async () => {
    const openEntry = {
      id: 'te_1',
      clockIn: d('2026-07-06T09:00:00Z'),
      clockOut: null,
    };
    mockDb.query.timeEntry.findFirst.mockResolvedValueOnce(openEntry);
    mockDb.returning.mockResolvedValueOnce([
      {
        ...openEntry,
        clockOut: d('2026-07-06T17:00:00Z'),
        status: 'completed',
      },
    ]);

    const deps = makeDeps({
      getWageAutomationConfig: vi.fn().mockResolvedValue({
        autoClockIn: 'enabled',
        autoClockOut: 'enabled',
        automatedBreaks: 'disabled',
      }),
    });

    const result = await runAutoClock(
      mockDb as never,
      { ...input, now: d('2026-07-06T17:03:00Z') },
      deps
    );

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.autoBreaksInserted).toBe(0);
    expect(deps.getUnpaidBlockedTimeOccurrences).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing practitionerId', async () => {
    const result = await runAutoClock(
      mockDb as never,
      { organizationId: 'org_123', practitionerId: '' },
      makeDeps()
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns INTERNAL_ERROR when a dependency fails', async () => {
    const deps = makeDeps({
      getShiftWindows: vi.fn().mockRejectedValue(new Error('shift query boom')),
    });

    const result = await runAutoClock(mockDb as never, input, deps);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
