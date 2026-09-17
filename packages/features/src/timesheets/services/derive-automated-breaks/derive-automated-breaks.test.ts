import { describe, expect, it } from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { deriveAutomatedBreaks } from './derive-automated-breaks.service.js';

const d = (iso: string) => new Date(iso);

describe('deriveAutomatedBreaks', () => {
  const clockIn = d('2026-07-06T09:00:00Z');
  const clockOut = d('2026-07-06T17:00:00Z');

  it('turns an unpaid occurrence inside the window into a break', () => {
    const result = deriveAutomatedBreaks({
      clockIn,
      clockOut,
      occurrences: [
        {
          start: d('2026-07-06T12:00:00Z'),
          end: d('2026-07-06T12:30:00Z'),
          paid: false,
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([
        {
          breakStart: d('2026-07-06T12:00:00Z'),
          breakEnd: d('2026-07-06T12:30:00Z'),
        },
      ]);
    }
  });

  it('excludes paid occurrences', () => {
    const result = deriveAutomatedBreaks({
      clockIn,
      clockOut,
      occurrences: [
        {
          start: d('2026-07-06T12:00:00Z'),
          end: d('2026-07-06T13:00:00Z'),
          paid: true,
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual([]);
  });

  it('clips occurrences that straddle the entry window', () => {
    const result = deriveAutomatedBreaks({
      clockIn,
      clockOut,
      occurrences: [
        {
          start: d('2026-07-06T08:30:00Z'),
          end: d('2026-07-06T09:30:00Z'),
          paid: false,
        },
        {
          start: d('2026-07-06T16:45:00Z'),
          end: d('2026-07-06T18:00:00Z'),
          paid: false,
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([
        { breakStart: clockIn, breakEnd: d('2026-07-06T09:30:00Z') },
        { breakStart: d('2026-07-06T16:45:00Z'), breakEnd: clockOut },
      ]);
    }
  });

  it('drops occurrences fully outside the window', () => {
    const result = deriveAutomatedBreaks({
      clockIn,
      clockOut,
      occurrences: [
        {
          start: d('2026-07-06T07:00:00Z'),
          end: d('2026-07-06T08:00:00Z'),
          paid: false,
        },
        {
          start: d('2026-07-06T18:00:00Z'),
          end: d('2026-07-06T19:00:00Z'),
          paid: false,
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual([]);
  });

  it('merges overlapping and adjacent unpaid occurrences', () => {
    const result = deriveAutomatedBreaks({
      clockIn,
      clockOut,
      occurrences: [
        {
          start: d('2026-07-06T12:00:00Z'),
          end: d('2026-07-06T12:30:00Z'),
          paid: false,
        },
        {
          start: d('2026-07-06T12:15:00Z'),
          end: d('2026-07-06T12:45:00Z'),
          paid: false,
        },
        // adjacent — touches the previous end exactly
        {
          start: d('2026-07-06T12:45:00Z'),
          end: d('2026-07-06T13:00:00Z'),
          paid: false,
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([
        {
          breakStart: d('2026-07-06T12:00:00Z'),
          breakEnd: d('2026-07-06T13:00:00Z'),
        },
      ]);
    }
  });

  it('returns sorted, disjoint breaks for out-of-order input', () => {
    const result = deriveAutomatedBreaks({
      clockIn,
      clockOut,
      occurrences: [
        {
          start: d('2026-07-06T15:00:00Z'),
          end: d('2026-07-06T15:15:00Z'),
          paid: false,
        },
        {
          start: d('2026-07-06T10:00:00Z'),
          end: d('2026-07-06T10:15:00Z'),
          paid: false,
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.map((b) => b.breakStart.toISOString())).toEqual([
        '2026-07-06T10:00:00.000Z',
        '2026-07-06T15:00:00.000Z',
      ]);
    }
  });

  it('mixed paid/unpaid: only unpaid intervals surface', () => {
    const result = deriveAutomatedBreaks({
      clockIn,
      clockOut,
      occurrences: [
        {
          start: d('2026-07-06T10:00:00Z'),
          end: d('2026-07-06T11:00:00Z'),
          paid: true,
        },
        {
          start: d('2026-07-06T12:00:00Z'),
          end: d('2026-07-06T12:30:00Z'),
          paid: false,
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].breakStart).toEqual(d('2026-07-06T12:00:00Z'));
    }
  });

  it('returns VALIDATION_ERROR when clockOut <= clockIn', () => {
    const result = deriveAutomatedBreaks({
      clockIn: clockOut,
      clockOut: clockIn,
      occurrences: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
