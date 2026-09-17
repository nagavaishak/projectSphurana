import { describe, expect, it } from 'vitest';

import type { TimeEntryWithBreaks } from '@borradh-workspace/api-client/types';

import { totalBreakMs, workedMs } from './compute';

const HOUR = 60 * 60 * 1000;

/** Minimal entry factory — only the fields the compute helpers read. */
function entry(
  over: Partial<TimeEntryWithBreaks> & Pick<TimeEntryWithBreaks, 'clockIn'>
): TimeEntryWithBreaks {
  return {
    clockOut: null,
    breaks: [],
    ...over,
  } as TimeEntryWithBreaks;
}

describe('totalBreakMs', () => {
  it('sums non-overlapping breaks', () => {
    const e = entry({
      clockIn: '2026-07-06T09:00:00Z',
      clockOut: '2026-07-06T17:00:00Z',
      breaks: [
        {
          breakStart: '2026-07-06T12:00:00Z',
          breakEnd: '2026-07-06T12:30:00Z',
        },
        {
          breakStart: '2026-07-06T15:00:00Z',
          breakEnd: '2026-07-06T15:15:00Z',
        },
      ] as TimeEntryWithBreaks['breaks'],
    });

    expect(totalBreakMs(e)).toBe(45 * 60 * 1000);
  });

  it('merges overlapping breaks so shared time is counted once', () => {
    // Auto-break 12:00–13:00 overlaps a manual break 12:30–13:30.
    // Merged span = 12:00–13:30 = 90 minutes (not 60 + 60 = 120).
    const e = entry({
      clockIn: '2026-07-06T09:00:00Z',
      clockOut: '2026-07-06T17:00:00Z',
      breaks: [
        {
          breakStart: '2026-07-06T12:00:00Z',
          breakEnd: '2026-07-06T13:00:00Z',
        },
        {
          breakStart: '2026-07-06T12:30:00Z',
          breakEnd: '2026-07-06T13:30:00Z',
        },
      ] as TimeEntryWithBreaks['breaks'],
    });

    expect(totalBreakMs(e)).toBe(90 * 60 * 1000);
  });

  it('collapses a fully-contained break', () => {
    const e = entry({
      clockIn: '2026-07-06T09:00:00Z',
      clockOut: '2026-07-06T17:00:00Z',
      breaks: [
        {
          breakStart: '2026-07-06T12:00:00Z',
          breakEnd: '2026-07-06T14:00:00Z',
        },
        {
          breakStart: '2026-07-06T12:30:00Z',
          breakEnd: '2026-07-06T13:00:00Z',
        },
      ] as TimeEntryWithBreaks['breaks'],
    });

    expect(totalBreakMs(e)).toBe(2 * HOUR);
  });

  it('clips breaks to the entry window', () => {
    // Break starts before clock-in; only the in-window part counts.
    const e = entry({
      clockIn: '2026-07-06T09:00:00Z',
      clockOut: '2026-07-06T17:00:00Z',
      breaks: [
        {
          breakStart: '2026-07-06T08:30:00Z',
          breakEnd: '2026-07-06T09:30:00Z',
        },
      ] as TimeEntryWithBreaks['breaks'],
    });

    expect(totalBreakMs(e)).toBe(30 * 60 * 1000);
  });
});

describe('workedMs', () => {
  it('does not over-subtract worked time for overlapping breaks', () => {
    const e = entry({
      clockIn: '2026-07-06T09:00:00Z',
      clockOut: '2026-07-06T17:00:00Z',
      breaks: [
        {
          breakStart: '2026-07-06T12:00:00Z',
          breakEnd: '2026-07-06T13:00:00Z',
        },
        {
          breakStart: '2026-07-06T12:30:00Z',
          breakEnd: '2026-07-06T13:30:00Z',
        },
      ] as TimeEntryWithBreaks['breaks'],
    });

    // 8h span − 1.5h merged break = 6.5h.
    expect(workedMs(e)).toBe(6.5 * HOUR);
  });
});
