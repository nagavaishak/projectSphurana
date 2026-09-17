import { describe, expect, it } from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import type { OvertimeWageConfigInput } from './calculate-overtime-pay.schema.js';
import { calculateOvertimePay } from './calculate-overtime-pay.service.js';

const d = (iso: string) => new Date(iso);

const hourlyConfig = (
  overrides: Partial<OvertimeWageConfigInput> = {}
): OvertimeWageConfigInput => ({
  compensationType: 'hourly',
  hourlyRateCents: 2000, // €20/h
  overtimeEnabled: false,
  regularWorkHours: null,
  regularWorkHoursPer: 'week',
  overtimeType: null,
  overtimeMultiplier: null,
  overtimeHourlyRateCents: null,
  ...overrides,
});

const entry = (
  clockIn: string,
  clockOut: string | null,
  breaks: { breakStart: string; breakEnd: string | null }[] = []
) => ({
  clockIn: d(clockIn),
  clockOut: clockOut ? d(clockOut) : null,
  breaks: breaks.map((b) => ({
    breakStart: d(b.breakStart),
    breakEnd: b.breakEnd ? d(b.breakEnd) : null,
  })),
});

describe('calculateOvertimePay', () => {
  it('computes plain hourly pay with no overtime configured', () => {
    const result = calculateOvertimePay({
      wageConfig: hourlyConfig(),
      entries: [entry('2026-07-06T09:00:00Z', '2026-07-06T17:00:00Z')],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalWorkedMinutes).toBe(480);
      expect(result.data.regularMinutes).toBe(480);
      expect(result.data.overtimeMinutes).toBe(0);
      expect(result.data.regularPayCents).toBe(16000); // 8h × €20
      expect(result.data.overtimePayCents).toBe(0);
      expect(result.data.totalPayCents).toBe(16000);
    }
  });

  it('deducts break minutes (merged, clipped to entry window)', () => {
    const result = calculateOvertimePay({
      wageConfig: hourlyConfig(),
      entries: [
        entry('2026-07-06T09:00:00Z', '2026-07-06T17:00:00Z', [
          {
            breakStart: '2026-07-06T12:00:00Z',
            breakEnd: '2026-07-06T12:30:00Z',
          },
          // overlaps previous break — only the union (12:00–12:45) counts
          {
            breakStart: '2026-07-06T12:15:00Z',
            breakEnd: '2026-07-06T12:45:00Z',
          },
        ]),
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalWorkedMinutes).toBe(480 - 45);
      expect(result.data.regularPayCents).toBe(Math.round((435 / 60) * 2000));
    }
  });

  it('clamps an open break to the entry clock-out', () => {
    const result = calculateOvertimePay({
      wageConfig: hourlyConfig(),
      entries: [
        entry('2026-07-06T09:00:00Z', '2026-07-06T17:00:00Z', [
          { breakStart: '2026-07-06T16:30:00Z', breakEnd: null },
        ]),
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.totalWorkedMinutes).toBe(450);
  });

  it('skips open entries entirely', () => {
    const result = calculateOvertimePay({
      wageConfig: hourlyConfig(),
      entries: [
        entry('2026-07-06T09:00:00Z', null),
        entry('2026-07-06T09:00:00Z', '2026-07-06T10:00:00Z'),
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.totalWorkedMinutes).toBe(60);
  });

  it('per-day overtime with multiplier rate', () => {
    const result = calculateOvertimePay({
      wageConfig: hourlyConfig({
        overtimeEnabled: true,
        regularWorkHours: 8,
        regularWorkHoursPer: 'day',
        overtimeType: 'multiplier',
        overtimeMultiplier: 1.5,
      }),
      entries: [
        // 10h on Monday → 2h overtime
        entry('2026-07-06T08:00:00Z', '2026-07-06T18:00:00Z'),
        // 6h on Tuesday → no overtime
        entry('2026-07-07T09:00:00Z', '2026-07-07T15:00:00Z'),
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.regularMinutes).toBe(8 * 60 + 6 * 60);
      expect(result.data.overtimeMinutes).toBe(120);
      expect(result.data.regularPayCents).toBe(14 * 2000);
      expect(result.data.overtimePayCents).toBe(2 * 3000); // 1.5×
      expect(result.data.totalPayCents).toBe(28000 + 6000);
      expect(result.data.days).toEqual([
        {
          date: '2026-07-06',
          workedMinutes: 600,
          regularMinutes: 480,
          overtimeMinutes: 120,
        },
        {
          date: '2026-07-07',
          workedMinutes: 360,
          regularMinutes: 360,
          overtimeMinutes: 0,
        },
      ]);
    }
  });

  it('per-day overtime with fixed hourly overtime rate', () => {
    const result = calculateOvertimePay({
      wageConfig: hourlyConfig({
        overtimeEnabled: true,
        regularWorkHours: 8,
        regularWorkHoursPer: 'day',
        overtimeType: 'hourly_rate',
        overtimeHourlyRateCents: 3500,
      }),
      entries: [entry('2026-07-06T08:00:00Z', '2026-07-06T18:00:00Z')],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.overtimeMinutes).toBe(120);
      expect(result.data.overtimePayCents).toBe(2 * 3500);
    }
  });

  it('per-week overtime crosses the threshold mid-week', () => {
    const result = calculateOvertimePay({
      wageConfig: hourlyConfig({
        overtimeEnabled: true,
        regularWorkHours: 20,
        regularWorkHoursPer: 'week',
        overtimeType: 'multiplier',
        overtimeMultiplier: 2,
      }),
      entries: [
        // Mon 10h, Tue 10h, Wed 4h → 24h in week of 2026-07-06 ⇒ 4h OT on Wed
        entry('2026-07-06T08:00:00Z', '2026-07-06T18:00:00Z'),
        entry('2026-07-07T08:00:00Z', '2026-07-07T18:00:00Z'),
        entry('2026-07-08T08:00:00Z', '2026-07-08T12:00:00Z'),
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.overtimeMinutes).toBe(240);
      expect(result.data.days[2]).toEqual({
        date: '2026-07-08',
        workedMinutes: 240,
        regularMinutes: 0,
        overtimeMinutes: 240,
      });
      expect(result.data.overtimePayCents).toBe(4 * 4000); // 2× €20
      expect(result.data.regularPayCents).toBe(20 * 2000);
    }
  });

  it('per-week overtime resets across week boundaries (Monday-based)', () => {
    const result = calculateOvertimePay({
      wageConfig: hourlyConfig({
        overtimeEnabled: true,
        regularWorkHours: 8,
        regularWorkHoursPer: 'week',
        overtimeType: 'multiplier',
        overtimeMultiplier: 1.5,
      }),
      entries: [
        // Sunday 2026-07-05 (end of previous week): 10h → 2h OT in that week
        entry('2026-07-05T08:00:00Z', '2026-07-05T18:00:00Z'),
        // Monday 2026-07-06 (new week): 6h → no OT
        entry('2026-07-06T09:00:00Z', '2026-07-06T15:00:00Z'),
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.overtimeMinutes).toBe(120);
      expect(result.data.days[1].overtimeMinutes).toBe(0);
    }
  });

  it('overtimeEnabled=false keeps everything regular even past threshold', () => {
    const result = calculateOvertimePay({
      wageConfig: hourlyConfig({
        overtimeEnabled: false,
        regularWorkHours: 4,
        regularWorkHoursPer: 'day',
      }),
      entries: [entry('2026-07-06T08:00:00Z', '2026-07-06T18:00:00Z')],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.overtimeMinutes).toBe(0);
      expect(result.data.regularMinutes).toBe(600);
    }
  });

  it('compensationType none computes minutes but zero pay', () => {
    const result = calculateOvertimePay({
      wageConfig: hourlyConfig({
        compensationType: 'none',
        hourlyRateCents: null,
      }),
      entries: [entry('2026-07-06T09:00:00Z', '2026-07-06T17:00:00Z')],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalWorkedMinutes).toBe(480);
      expect(result.data.totalPayCents).toBe(0);
    }
  });

  it('multiple entries on the same day aggregate before the day threshold', () => {
    const result = calculateOvertimePay({
      wageConfig: hourlyConfig({
        overtimeEnabled: true,
        regularWorkHours: 8,
        regularWorkHoursPer: 'day',
        overtimeType: 'multiplier',
        overtimeMultiplier: 1.5,
      }),
      entries: [
        entry('2026-07-06T08:00:00Z', '2026-07-06T13:00:00Z'), // 5h
        entry('2026-07-06T14:00:00Z', '2026-07-06T19:00:00Z'), // 5h
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.days).toHaveLength(1);
      expect(result.data.overtimeMinutes).toBe(120);
    }
  });

  it('buckets days in the provided timezone', () => {
    // 23:30 UTC on Jul 6 is 00:30 Jul 7 in Dublin (UTC+1 in July)
    const result = calculateOvertimePay({
      wageConfig: hourlyConfig(),
      entries: [entry('2026-07-06T23:30:00Z', '2026-07-07T01:30:00Z')],
      timezone: 'Europe/Dublin',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.days[0].date).toBe('2026-07-07');
    }
  });

  it('returns VALIDATION_ERROR for hourly compensation without a rate', () => {
    const result = calculateOvertimePay({
      wageConfig: hourlyConfig({ hourlyRateCents: null }),
      entries: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR when overtime enabled without overtimeType', () => {
    const result = calculateOvertimePay({
      wageConfig: hourlyConfig({
        overtimeEnabled: true,
        regularWorkHours: 8,
      }),
      entries: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for multiplier overtime without a multiplier', () => {
    const result = calculateOvertimePay({
      wageConfig: hourlyConfig({
        overtimeEnabled: true,
        regularWorkHours: 8,
        overtimeType: 'multiplier',
      }),
      entries: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for hourly_rate overtime without a rate', () => {
    const result = calculateOvertimePay({
      wageConfig: hourlyConfig({
        overtimeEnabled: true,
        regularWorkHours: 8,
        overtimeType: 'hourly_rate',
      }),
      entries: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for an invalid timezone', () => {
    const result = calculateOvertimePay({
      wageConfig: hourlyConfig(),
      entries: [entry('2026-07-06T09:00:00Z', '2026-07-06T17:00:00Z')],
      timezone: 'Not/AZone',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('rounds pay to whole cents', () => {
    const result = calculateOvertimePay({
      wageConfig: hourlyConfig({ hourlyRateCents: 1999 }),
      entries: [entry('2026-07-06T09:00:00Z', '2026-07-06T09:10:00Z')], // 10 min
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.regularPayCents).toBe(Math.round((10 / 60) * 1999)); // 333
      expect(Number.isInteger(result.data.totalPayCents)).toBe(true);
    }
  });
});
