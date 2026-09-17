import { describe, expect, it } from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import {
  deriveAutoClock,
  resolveAutomationFlags,
} from './derive-auto-clock.service.js';

const d = (iso: string) => new Date(iso);

describe('resolveAutomationFlags', () => {
  const allDefault = {
    autoClockIn: 'workspace_default',
    autoClockOut: 'workspace_default',
    automatedBreaks: 'workspace_default',
  } as const;

  it('explicit enabled wins over org default false', () => {
    const result = resolveAutomationFlags({
      wageConfig: { ...allDefault, autoClockIn: 'enabled' },
      orgDefaults: {
        wageAutoClockIn: false,
        wageAutoClockOut: false,
        wageAutomatedBreaks: false,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.autoClockIn).toBe(true);
  });

  it('explicit disabled wins over org default true', () => {
    const result = resolveAutomationFlags({
      wageConfig: { ...allDefault, autoClockOut: 'disabled' },
      orgDefaults: {
        wageAutoClockIn: true,
        wageAutoClockOut: true,
        wageAutomatedBreaks: true,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.autoClockOut).toBe(false);
      expect(result.data.autoClockIn).toBe(true); // workspace_default → org true
      expect(result.data.automatedBreaks).toBe(true);
    }
  });

  it('workspace_default falls through to org default, then false', () => {
    const result = resolveAutomationFlags({
      wageConfig: allDefault,
      orgDefaults: {
        wageAutoClockIn: true,
        wageAutoClockOut: null,
        wageAutomatedBreaks: null,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.autoClockIn).toBe(true);
      expect(result.data.autoClockOut).toBe(false);
      expect(result.data.automatedBreaks).toBe(false);
    }
  });

  it('missing wage config row behaves as all workspace_default', () => {
    const result = resolveAutomationFlags({
      wageConfig: null,
      orgDefaults: {
        wageAutoClockIn: true,
        wageAutoClockOut: false,
        wageAutomatedBreaks: true,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        autoClockIn: true,
        autoClockOut: false,
        automatedBreaks: true,
      });
    }
  });

  it('missing everything resolves to system default false', () => {
    const result = resolveAutomationFlags({
      wageConfig: null,
      orgDefaults: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        autoClockIn: false,
        autoClockOut: false,
        automatedBreaks: false,
      });
    }
  });

  it('returns VALIDATION_ERROR for invalid setting value', () => {
    const result = resolveAutomationFlags({
      // @ts-expect-error invalid setting on purpose
      wageConfig: { ...allDefault, autoClockIn: 'sometimes' },
      orgDefaults: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});

describe('deriveAutoClock', () => {
  const window9to17 = {
    start: d('2026-07-06T09:00:00Z'),
    end: d('2026-07-06T17:00:00Z'),
  };
  const bothFlags = { autoClockIn: true, autoClockOut: true };

  it('does nothing before shift start', () => {
    const result = deriveAutoClock({
      now: d('2026-07-06T08:55:00Z'),
      flags: bothFlags,
      shiftWindows: [window9to17],
      openEntry: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ clockIn: null, clockOut: null });
    }
  });

  it('clocks in at shift start once now >= start', () => {
    const result = deriveAutoClock({
      now: d('2026-07-06T09:03:00Z'),
      flags: bothFlags,
      shiftWindows: [window9to17],
      openEntry: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clockIn).toEqual({ at: window9to17.start });
      expect(result.data.clockOut).toBeNull();
    }
  });

  it('does not clock in when an open entry exists', () => {
    const result = deriveAutoClock({
      now: d('2026-07-06T09:30:00Z'),
      flags: bothFlags,
      shiftWindows: [window9to17],
      openEntry: { id: 'te_1', clockIn: d('2026-07-06T09:00:00Z') },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clockIn).toBeNull();
      expect(result.data.clockOut).toBeNull();
    }
  });

  it('does not clock in when autoClockIn is disabled', () => {
    const result = deriveAutoClock({
      now: d('2026-07-06T09:30:00Z'),
      flags: { autoClockIn: false, autoClockOut: true },
      shiftWindows: [window9to17],
      openEntry: null,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.clockIn).toBeNull();
  });

  it('does not clock in for a window that has already ended', () => {
    const result = deriveAutoClock({
      now: d('2026-07-06T18:00:00Z'),
      flags: bothFlags,
      shiftWindows: [window9to17],
      openEntry: null,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.clockIn).toBeNull();
  });

  it('clocks out at shift end once now >= end', () => {
    const result = deriveAutoClock({
      now: d('2026-07-06T17:02:00Z'),
      flags: bothFlags,
      shiftWindows: [window9to17],
      openEntry: { id: 'te_1', clockIn: d('2026-07-06T09:00:00Z') },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clockOut).toEqual({
        timeEntryId: 'te_1',
        at: window9to17.end,
      });
      expect(result.data.clockIn).toBeNull();
    }
  });

  it('does not clock out before shift end', () => {
    const result = deriveAutoClock({
      now: d('2026-07-06T16:59:00Z'),
      flags: bothFlags,
      shiftWindows: [window9to17],
      openEntry: { id: 'te_1', clockIn: d('2026-07-06T09:00:00Z') },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.clockOut).toBeNull();
  });

  it('does not clock out when autoClockOut is disabled', () => {
    const result = deriveAutoClock({
      now: d('2026-07-06T18:00:00Z'),
      flags: { autoClockIn: true, autoClockOut: false },
      shiftWindows: [window9to17],
      openEntry: { id: 'te_1', clockIn: d('2026-07-06T09:00:00Z') },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.clockOut).toBeNull();
  });

  it('ignores window ends that precede the entry clock-in', () => {
    const morning = {
      start: d('2026-07-06T09:00:00Z'),
      end: d('2026-07-06T12:00:00Z'),
    };
    const result = deriveAutoClock({
      now: d('2026-07-06T13:00:00Z'),
      flags: bothFlags,
      shiftWindows: [morning],
      // clocked in after the morning window ended (e.g. manual afternoon entry)
      openEntry: { id: 'te_1', clockIn: d('2026-07-06T12:30:00Z') },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.clockOut).toBeNull();
  });

  it('split shift: closes the morning entry at 12:00 and opens the afternoon at 13:00 in one tick', () => {
    const morning = {
      start: d('2026-07-06T09:00:00Z'),
      end: d('2026-07-06T12:00:00Z'),
    };
    const afternoon = {
      start: d('2026-07-06T13:00:00Z'),
      end: d('2026-07-06T17:00:00Z'),
    };
    const result = deriveAutoClock({
      now: d('2026-07-06T13:30:00Z'),
      flags: bothFlags,
      shiftWindows: [morning, afternoon],
      openEntry: { id: 'te_1', clockIn: d('2026-07-06T09:00:00Z') },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clockOut).toEqual({
        timeEntryId: 'te_1',
        at: morning.end,
      });
      expect(result.data.clockIn).toEqual({ at: afternoon.start });
    }
  });

  it('split shift: picks the latest elapsed window end when several have passed', () => {
    const morning = {
      start: d('2026-07-06T09:00:00Z'),
      end: d('2026-07-06T12:00:00Z'),
    };
    const afternoon = {
      start: d('2026-07-06T13:00:00Z'),
      end: d('2026-07-06T17:00:00Z'),
    };
    const result = deriveAutoClock({
      now: d('2026-07-06T18:00:00Z'),
      flags: bothFlags,
      shiftWindows: [morning, afternoon],
      openEntry: { id: 'te_1', clockIn: d('2026-07-06T09:00:00Z') },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clockOut).toEqual({
        timeEntryId: 'te_1',
        at: afternoon.end,
      });
      expect(result.data.clockIn).toBeNull();
    }
  });

  it('no shift windows (day off) means no actions', () => {
    const result = deriveAutoClock({
      now: d('2026-07-06T10:00:00Z'),
      flags: bothFlags,
      shiftWindows: [],
      openEntry: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ clockIn: null, clockOut: null });
    }
  });

  it('returns VALIDATION_ERROR for an inverted shift window', () => {
    const result = deriveAutoClock({
      now: d('2026-07-06T10:00:00Z'),
      flags: bothFlags,
      shiftWindows: [
        { start: d('2026-07-06T17:00:00Z'), end: d('2026-07-06T09:00:00Z') },
      ],
      openEntry: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
