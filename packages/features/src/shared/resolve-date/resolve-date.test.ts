import { describe, expect, it } from '@borradh-workspace/testing';
import {
  addMonths,
  describeToday,
  resolveDateExpression,
  resolveDateOnly,
  resolveDateTime,
  resolveRangePreset,
  todayInTimezone,
} from './resolve-date.js';

// Wednesday 2026-07-29, 12:00 UTC — Irish Summer Time (UTC+1).
const NOW = new Date('2026-07-29T12:00:00Z');
const DUBLIN = { timezone: 'Europe/Dublin', now: NOW };

describe('resolveDateExpression — absolute inputs', () => {
  it('passes an ISO date through unchanged', () => {
    expect(resolveDateExpression('2026-08-07', DUBLIN)).toEqual({
      kind: 'date',
      date: '2026-08-07',
    });
  });

  it('parses an ISO datetime with explicit Z as that instant', () => {
    const r = resolveDateExpression('2026-08-07T14:00:00Z', DUBLIN);
    expect(r).toEqual({
      kind: 'datetime',
      iso: '2026-08-07T14:00:00.000Z',
      date: '2026-08-07',
    });
  });

  it('interprets a zone-less ISO datetime as org-timezone wall time', () => {
    // 14:00 IST (UTC+1 in August) → 13:00Z.
    const r = resolveDateExpression('2026-08-07T14:00:00', DUBLIN);
    expect(r).toMatchObject({
      kind: 'datetime',
      iso: '2026-08-07T13:00:00.000Z',
    });
  });

  it('honours an explicit offset', () => {
    const r = resolveDateExpression('2026-08-07T14:00:00+02:00', DUBLIN);
    expect(r).toMatchObject({ iso: '2026-08-07T12:00:00.000Z' });
  });
});

describe('resolveDateExpression — relative dates', () => {
  it('resolves today / tomorrow / yesterday in the org timezone', () => {
    expect(resolveDateOnly('today', DUBLIN)).toBe('2026-07-29');
    expect(resolveDateOnly('tomorrow', DUBLIN)).toBe('2026-07-30');
    expect(resolveDateOnly('yesterday', DUBLIN)).toBe('2026-07-28');
  });

  it('resolves "today"/"tomorrow" against the org timezone, not UTC (timezone edge)', () => {
    const lateUtc = new Date('2026-07-29T23:30:00Z');
    // Auckland is already on the 30th.
    expect(
      resolveDateOnly('today', { timezone: 'Pacific/Auckland', now: lateUtc })
    ).toBe('2026-07-30');
    expect(
      resolveDateOnly('tomorrow', {
        timezone: 'Pacific/Auckland',
        now: lateUtc,
      })
    ).toBe('2026-07-31');
    // Los Angeles is still on the 29th.
    expect(
      resolveDateOnly('today', {
        timezone: 'America/Los_Angeles',
        now: lateUtc,
      })
    ).toBe('2026-07-29');
  });

  it('resolves "in N units" and "N units from now"', () => {
    expect(resolveDateOnly('in 2 weeks', DUBLIN)).toBe('2026-08-12');
    expect(resolveDateOnly('in 3 days', DUBLIN)).toBe('2026-08-01');
    expect(resolveDateOnly('in a month', DUBLIN)).toBe('2026-08-29');
    expect(resolveDateOnly('2 weeks from now', DUBLIN)).toBe('2026-08-12');
  });

  it('resolves day names to the next future occurrence', () => {
    // NOW is a Wednesday.
    expect(resolveDateOnly('friday', DUBLIN)).toBe('2026-07-31');
    expect(resolveDateOnly('next friday', DUBLIN)).toBe('2026-07-31');
    // Same day name → next week, never today.
    expect(resolveDateOnly('wednesday', DUBLIN)).toBe('2026-08-05');
  });

  it('resolves month-day expressions to the NEXT future occurrence (register #158)', () => {
    expect(resolveDateOnly('until August 7th', DUBLIN)).toBe('2026-08-07');
    expect(resolveDateOnly('august 7', DUBLIN)).toBe('2026-08-07');
    expect(resolveDateOnly('7th August', DUBLIN)).toBe('2026-08-07');
    // Already passed this year → next year, never the past.
    const september = {
      timezone: 'Europe/Dublin',
      now: new Date('2026-09-01T12:00:00Z'),
    };
    expect(resolveDateOnly('until August 7th', september)).toBe('2027-08-07');
  });

  it('honours an explicit year on month-day expressions', () => {
    expect(resolveDateOnly('august 7 2026', DUBLIN)).toBe('2026-08-07');
    expect(resolveDateOnly('7 august 2027', DUBLIN)).toBe('2027-08-07');
  });

  it('returns null for unresolvable expressions', () => {
    expect(resolveDateExpression('whenever suits', DUBLIN)).toBeNull();
    expect(resolveDateExpression('', DUBLIN)).toBeNull();
  });

  // Every phrase the offer tool descriptions advertise verbatim must resolve —
  // the description IS the model's instruction, so a phrase the grammar
  // rejects means the tool 400s on its own documented happy path.
  it('resolves every date phrase the offer tool descriptions advertise', () => {
    // create-offer.tool.ts
    expect(resolveDateOnly('today', DUBLIN)).toBe('2026-07-29');
    expect(resolveDateOnly('next Monday', DUBLIN)).toBe('2026-08-03');
    expect(resolveDateOnly('valid for 2 weeks', DUBLIN)).toBe('2026-07-29');
    expect(resolveDateOnly('until August 7th', DUBLIN)).toBe('2026-08-07');
    expect(resolveDateOnly('end of the month', DUBLIN)).toBe('2026-07-31');
    expect(resolveDateOnly('in 30 days', DUBLIN)).toBe('2026-08-28');
    // extend-offer.tool.ts
    expect(resolveDateOnly('another 2 weeks', DUBLIN)).toBe('2026-08-12');
    expect(resolveDateOnly('until end of August', DUBLIN)).toBe('2026-08-31');
    expect(resolveDateOnly('in 10 days', DUBLIN)).toBe('2026-08-08');
    // find-open-slots.tool.ts / book-appointment.tool.ts
    expect(resolveDateOnly('tomorrow', DUBLIN)).toBe('2026-07-30');
    expect(resolveDateOnly('next Friday', DUBLIN)).toBe('2026-07-31');
  });

  it('resolves "end of …" windows to the LAST day of the window', () => {
    expect(resolveDateOnly('end of month', DUBLIN)).toBe('2026-07-31');
    expect(resolveDateOnly('end of this month', DUBLIN)).toBe('2026-07-31');
    expect(resolveDateOnly('end of next month', DUBLIN)).toBe('2026-08-31');
    // Feb of a non-leap year, via the next-future-occurrence rule.
    expect(resolveDateOnly('end of February', DUBLIN)).toBe('2027-02-28');
    // Wed 2026-07-29 → the ISO week runs Mon 27 … Sun 2026-08-02.
    expect(resolveDateOnly('end of the week', DUBLIN)).toBe('2026-08-02');
    expect(resolveDateOnly('end of next week', DUBLIN)).toBe('2026-08-09');
    expect(resolveDateOnly('end of the year', DUBLIN)).toBe('2026-12-31');
    expect(resolveDateExpression('end of whenever', DUBLIN)).toBeNull();
  });
});

describe('resolveDateExpression — ranges', () => {
  it('resolves "this week" to the Monday–Sunday week containing today (register #193)', () => {
    expect(resolveDateExpression('this week', DUBLIN)).toEqual({
      kind: 'range',
      start: '2026-07-27',
      end: '2026-08-02',
    });
  });

  it('resolves "this week" correctly on a Sunday', () => {
    const sunday = {
      timezone: 'Europe/Dublin',
      now: new Date('2026-08-02T12:00:00Z'),
    };
    expect(resolveDateExpression('this week', sunday)).toEqual({
      kind: 'range',
      start: '2026-07-27',
      end: '2026-08-02',
    });
  });

  it('resolves "next week" and calendar months', () => {
    expect(resolveDateExpression('next week', DUBLIN)).toEqual({
      kind: 'range',
      start: '2026-08-03',
      end: '2026-08-09',
    });
    expect(resolveDateExpression('this month', DUBLIN)).toEqual({
      kind: 'range',
      start: '2026-07-01',
      end: '2026-07-31',
    });
    expect(resolveDateExpression('next month', DUBLIN)).toEqual({
      kind: 'range',
      start: '2026-08-01',
      end: '2026-08-31',
    });
  });

  it('resolves forward windows: "next 2 weeks" / "valid for 2 weeks"', () => {
    expect(resolveDateExpression('next 2 weeks', DUBLIN)).toEqual({
      kind: 'range',
      start: '2026-07-29',
      end: '2026-08-12',
    });
    expect(resolveDateExpression('for the next 14 days', DUBLIN)).toEqual({
      kind: 'range',
      start: '2026-07-29',
      end: '2026-08-12',
    });
    expect(resolveDateExpression('valid for 2 weeks', DUBLIN)).toEqual({
      kind: 'range',
      start: '2026-07-29',
      end: '2026-08-12',
    });
  });
});

describe('resolveDateExpression — times of day', () => {
  it('resolves "tomorrow 2pm" in the org timezone (register #208)', () => {
    const r = resolveDateExpression('tomorrow 2pm', DUBLIN);
    // 14:00 IST → 13:00Z, and in the CURRENT year, not the training prior.
    expect(r).toEqual({
      kind: 'datetime',
      iso: '2026-07-30T13:00:00.000Z',
      date: '2026-07-30',
    });
  });

  it('supports "at", minutes, 24h clock, and 12am/12pm', () => {
    expect(resolveDateExpression('tomorrow at 2:30pm', DUBLIN)).toMatchObject({
      iso: '2026-07-30T13:30:00.000Z',
    });
    expect(resolveDateExpression('tomorrow 14:30', DUBLIN)).toMatchObject({
      iso: '2026-07-30T13:30:00.000Z',
    });
    expect(resolveDateExpression('tomorrow 12am', DUBLIN)).toMatchObject({
      iso: '2026-07-29T23:00:00.000Z', // midnight IST
    });
    expect(resolveDateExpression('friday 12pm', DUBLIN)).toMatchObject({
      iso: '2026-07-31T11:00:00.000Z',
    });
  });

  it('a bare time means today', () => {
    expect(resolveDateExpression('2pm', DUBLIN)).toMatchObject({
      iso: '2026-07-29T13:00:00.000Z',
      date: '2026-07-29',
    });
  });

  it('never misreads a bare day number as an hour', () => {
    // "august 7" must stay a DATE, not "august" + 7:00.
    expect(resolveDateExpression('august 7', DUBLIN)).toEqual({
      kind: 'date',
      date: '2026-08-07',
    });
  });
});

describe('DST edges', () => {
  it('Europe/Dublin spring-forward: same wall time, different UTC offset', () => {
    // DST starts Sunday 2026-03-29 in Ireland.
    const beforeDst = {
      timezone: 'Europe/Dublin',
      now: new Date('2026-03-28T09:00:00Z'),
    };
    expect(resolveDateExpression('today 2pm', beforeDst)).toMatchObject({
      iso: '2026-03-28T14:00:00.000Z', // GMT (UTC+0)
    });
    expect(resolveDateExpression('tomorrow 2pm', beforeDst)).toMatchObject({
      iso: '2026-03-29T13:00:00.000Z', // IST (UTC+1) after the switch
    });
  });

  it('America/New_York spring-forward', () => {
    // US DST starts Sunday 2026-03-08.
    const beforeDst = {
      timezone: 'America/New_York',
      now: new Date('2026-03-07T12:00:00Z'),
    };
    expect(resolveDateExpression('today 2pm', beforeDst)).toMatchObject({
      iso: '2026-03-07T19:00:00.000Z', // EST (UTC-5)
    });
    expect(resolveDateExpression('tomorrow 2pm', beforeDst)).toMatchObject({
      iso: '2026-03-08T18:00:00.000Z', // EDT (UTC-4)
    });
  });

  it('Europe/Dublin fall-back', () => {
    // DST ends Sunday 2026-10-25 in Ireland.
    const beforeEnd = {
      timezone: 'Europe/Dublin',
      now: new Date('2026-10-24T09:00:00Z'),
    };
    expect(resolveDateExpression('tomorrow 2pm', beforeEnd)).toMatchObject({
      iso: '2026-10-25T14:00:00.000Z', // back on GMT
    });
  });
});

describe('resolveDateTime edges', () => {
  it("date-only with edge 'end' lands at end of day in the org timezone", () => {
    // 23:59 IST → 22:59Z.
    expect(
      resolveDateTime('until august 7th', { ...DUBLIN, edge: 'end' })
    ).toBe('2026-08-07T22:59:00.000Z');
  });

  it("date-only with edge 'start' lands at start of day", () => {
    expect(resolveDateTime('tomorrow', { ...DUBLIN, edge: 'start' })).toBe(
      '2026-07-29T23:00:00.000Z' // 00:00 IST on the 30th
    );
  });

  it('ranges use the window end for edge \'end\' ("valid for 2 weeks")', () => {
    expect(
      resolveDateTime('valid for 2 weeks', { ...DUBLIN, edge: 'end' })
    ).toBe('2026-08-12T22:59:00.000Z');
    expect(resolveDateTime('next 2 weeks', { ...DUBLIN, edge: 'start' })).toBe(
      '2026-07-28T23:00:00.000Z' // start of 2026-07-29 IST
    );
  });

  it('explicit datetimes pass through regardless of edge', () => {
    expect(
      resolveDateTime('2026-08-07T14:00:00Z', { ...DUBLIN, edge: 'end' })
    ).toBe('2026-08-07T14:00:00.000Z');
  });
});

describe('resolveRangePreset', () => {
  it('resolves this_week to the full Monday–Sunday span', () => {
    expect(resolveRangePreset('this_week', DUBLIN)).toEqual({
      since: '2026-07-27',
      until: '2026-08-02',
    });
  });

  it('resolves rolling windows inclusively', () => {
    expect(resolveRangePreset('last_7_days', DUBLIN)).toEqual({
      since: '2026-07-23',
      until: '2026-07-29',
    });
    expect(resolveRangePreset('last_30_days', DUBLIN)).toEqual({
      since: '2026-06-30',
      until: '2026-07-29',
    });
  });

  it('resolves calendar presets', () => {
    expect(resolveRangePreset('yesterday', DUBLIN)).toEqual({
      since: '2026-07-28',
      until: '2026-07-28',
    });
    expect(resolveRangePreset('last_week', DUBLIN)).toEqual({
      since: '2026-07-20',
      until: '2026-07-26',
    });
    expect(resolveRangePreset('this_month', DUBLIN)).toEqual({
      since: '2026-07-01',
      until: '2026-07-31',
    });
    expect(resolveRangePreset('last_month', DUBLIN)).toEqual({
      since: '2026-06-01',
      until: '2026-06-30',
    });
  });

  it('resolves presets in the org timezone', () => {
    const lateUtc = new Date('2026-07-29T23:30:00Z');
    expect(
      resolveRangePreset('today', {
        timezone: 'Pacific/Auckland',
        now: lateUtc,
      })
    ).toEqual({ since: '2026-07-30', until: '2026-07-30' });
  });
});

describe('helpers', () => {
  it('todayInTimezone respects the zone', () => {
    expect(todayInTimezone(DUBLIN)).toBe('2026-07-29');
  });

  it('addMonths clamps to the last day of shorter months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
  });

  it('describeToday names the weekday, ISO date, and timezone', () => {
    expect(describeToday(DUBLIN)).toBe('Wednesday 2026-07-29 (Europe/Dublin)');
    const lateUtc = new Date('2026-07-29T23:30:00Z');
    expect(describeToday({ timezone: 'Pacific/Auckland', now: lateUtc })).toBe(
      'Thursday 2026-07-30 (Pacific/Auckland)'
    );
  });
});
