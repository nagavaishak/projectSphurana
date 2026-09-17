import type { TimeOff } from '@borradh-workspace/database';
import { describe, expect, it } from '@borradh-workspace/testing';
import { expandRecurrence } from './expand-blocked-time.js';
import { expandTimeOff } from './expand-time-off.js';

describe('expandRecurrence', () => {
  it('honours INTERVAL for WEEKLY (every 2 weeks, not every week)', () => {
    const start = new Date('2026-01-05T09:00:00Z'); // Monday
    const occ = expandRecurrence(
      'FREQ=WEEKLY;INTERVAL=2',
      start,
      'UTC',
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-03-01T00:00:00Z')
    );

    // Jan 5, Jan 19, Feb 2, Feb 16 — 14-day steps, NOT every 7 days.
    expect(occ.map((d) => d.toISOString())).toEqual([
      '2026-01-05T09:00:00.000Z',
      '2026-01-19T09:00:00.000Z',
      '2026-02-02T09:00:00.000Z',
      '2026-02-16T09:00:00.000Z',
    ]);
  });

  it('honours INTERVAL for MONTHLY (every 2 months)', () => {
    const start = new Date('2026-01-10T12:00:00Z');
    const occ = expandRecurrence(
      'FREQ=MONTHLY;INTERVAL=2',
      start,
      'UTC',
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-07-01T00:00:00Z')
    );

    expect(occ.map((d) => d.toISOString())).toEqual([
      '2026-01-10T12:00:00.000Z',
      '2026-03-10T12:00:00.000Z',
      '2026-05-10T12:00:00.000Z',
    ]);
  });

  it('honours INTERVAL for YEARLY (every 2 years)', () => {
    const start = new Date('2026-06-15T08:00:00Z');
    const occ = expandRecurrence(
      'FREQ=YEARLY;INTERVAL=2',
      start,
      'UTC',
      new Date('2026-01-01T00:00:00Z'),
      new Date('2031-01-01T00:00:00Z')
    );

    expect(occ.map((d) => d.toISOString())).toEqual([
      '2026-06-15T08:00:00.000Z',
      '2028-06-15T08:00:00.000Z',
      '2030-06-15T08:00:00.000Z',
    ]);
  });

  it('counts COUNT from the series start, not from the query window', () => {
    const start = new Date('2026-01-01T09:00:00Z');
    // COUNT=3 → only Jan 1, 2, 3 exist. A window that begins Jan 2 must NOT
    // over-emit (the old code counted only within the window).
    const occ = expandRecurrence(
      'FREQ=DAILY;COUNT=3',
      start,
      'UTC',
      new Date('2026-01-02T00:00:00Z'),
      new Date('2026-01-31T00:00:00Z')
    );

    expect(occ.map((d) => d.toISOString())).toEqual([
      '2026-01-02T09:00:00.000Z',
      '2026-01-03T09:00:00.000Z',
    ]);
  });

  it('expands weekly occurrences on the series time zone weekday (not UTC)', () => {
    // 2026-01-04 23:30 America/New_York (EST, UTC-5) = 2026-01-05 04:30 UTC.
    // Local weekday is Sunday even though the UTC instant is Monday.
    const start = new Date('2026-01-05T04:30:00Z');
    const occ = expandRecurrence(
      'FREQ=WEEKLY',
      start,
      'America/New_York',
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-02-01T00:00:00Z')
    );

    // Local Sundays Jan 4, 11, 18, 25 at 23:30 EST → +7 days each in UTC.
    expect(occ.map((d) => d.toISOString())).toEqual([
      '2026-01-05T04:30:00.000Z',
      '2026-01-12T04:30:00.000Z',
      '2026-01-19T04:30:00.000Z',
      '2026-01-26T04:30:00.000Z',
    ]);
    // First occurrence is exactly the stored series start.
    expect(occ[0].getTime()).toBe(start.getTime());
  });

  it('preserves the wall-clock hour across a DST transition', () => {
    // America/New_York springs forward on 2026-03-08. A daily 09:00 local
    // series must stay at 09:00 local (offset changes -5 → -4).
    const start = new Date('2026-03-06T14:00:00Z'); // 09:00 EST
    const occ = expandRecurrence(
      'FREQ=DAILY',
      start,
      'America/New_York',
      new Date('2026-03-06T00:00:00Z'),
      new Date('2026-03-10T00:00:00Z')
    );

    // Mar 6 & 7 are EST (14:00Z), Mar 8 & 9 are EDT (13:00Z) — same 09:00 local.
    expect(occ.map((d) => d.toISOString())).toEqual([
      '2026-03-06T14:00:00.000Z',
      '2026-03-07T14:00:00.000Z',
      '2026-03-08T13:00:00.000Z',
      '2026-03-09T13:00:00.000Z',
    ]);
  });
});

describe('expandTimeOff (recurrence wiring)', () => {
  it('applies INTERVAL and time zone via the shared expander', () => {
    const series = {
      startDate: new Date('2026-01-05T09:00:00Z'),
      endDate: new Date('2026-01-05T17:00:00Z'),
      rrule: 'FREQ=WEEKLY;INTERVAL=2',
      timezone: 'UTC',
    } as unknown as TimeOff;

    const ranges = expandTimeOff(
      series,
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-02-01T00:00:00Z')
    );

    expect(ranges.map((r) => r.start.toISOString())).toEqual([
      '2026-01-05T09:00:00.000Z',
      '2026-01-19T09:00:00.000Z',
    ]);
    // Duration preserved on each occurrence (8h).
    expect(ranges[0].end.getTime() - ranges[0].start.getTime()).toBe(
      8 * 60 * 60 * 1000
    );
  });
});
