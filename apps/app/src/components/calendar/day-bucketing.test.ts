import { describe, expect, it } from 'vitest';

import { getEventsCount, getMonthCellEvents, getViewRange } from './helpers';
import type { IEvent } from './interfaces';

/**
 * Day bucketing must resolve against the BUSINESS timezone, never the viewer's.
 *
 * Regression: an operator in Europe/Dublin administering an America/Los_Angeles
 * salon saw an empty day view while the API had returned every appointment. The
 * view window was built from browser-local `Date` constructors, so an LA 4:00 PM
 * booking (23:00Z) fell outside Dublin's calendar day (which ends at 22:59Z) and
 * was filed under tomorrow. The day view's own filter was already correct — the
 * events were discarded upstream, before it ever ran.
 *
 * These tests pin the window itself, asserting ABSOLUTE instants rather than
 * anything derived from the runner's own clock. The runner pins `TZ: 'UTC'`
 * (see vitest.config.ts), so every case here is chosen to discriminate even
 * there: each uses a non-UTC org zone and an instant that falls on a different
 * calendar day in UTC than it does in the org's zone. Six of these fail against
 * the browser-local implementation.
 */

const LA = 'America/Los_Angeles';
const DUBLIN = 'Europe/Dublin';

/** A local Date naming a calendar day — the convention `selectedDate` uses. */
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);

const event = (id: string, startISO: string, endISO: string): IEvent =>
  ({
    id,
    title: id,
    startDate: startISO,
    endDate: endISO,
    color: 'blue',
    user: { id: 'u1', name: 'Staff', picturePath: null },
  }) as unknown as IEvent;

describe('getViewRange', () => {
  it('bounds a day by the org timezone, not the viewer', () => {
    // 20 Aug 2026 in Los_Angeles (PDT, UTC-7) runs 07:00Z -> 07:00Z next day.
    const { start, end } = getViewRange(day(2026, 8, 20), 'day', LA);
    expect(start.toISOString()).toBe('2026-08-20T07:00:00.000Z');
    expect(end.toISOString()).toBe('2026-08-21T07:00:00.000Z');
  });

  it('gives the same calendar day a different window in a different zone', () => {
    // Same date in Dublin (IST, UTC+1) runs 23:00Z the previous day -> 23:00Z.
    const { start, end } = getViewRange(day(2026, 8, 20), 'day', DUBLIN);
    expect(start.toISOString()).toBe('2026-08-19T23:00:00.000Z');
    expect(end.toISOString()).toBe('2026-08-20T23:00:00.000Z');
  });

  it('spans exactly seven days for a week, across a month boundary', () => {
    // 30 Aug 2026 is a Sunday, so the week runs 30 Aug -> 6 Sep.
    const { start, end } = getViewRange(day(2026, 8, 30), 'week', LA);
    expect(start.toISOString()).toBe('2026-08-30T07:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-06T07:00:00.000Z');
  });

  it('spans a whole month, rolling the year over in December', () => {
    const { start, end } = getViewRange(day(2026, 12, 14), 'month', LA);
    expect(start.toISOString()).toBe('2026-12-01T08:00:00.000Z'); // PST, UTC-8
    expect(end.toISOString()).toBe('2027-01-01T08:00:00.000Z');
  });

  it('keeps a DST-shortened day exactly one calendar day long', () => {
    // 8 Mar 2026: US clocks skip 02:00 -> 03:00, so this day is 23h. Deriving
    // the end by adding 24h would overshoot into the next day.
    const { start, end } = getViewRange(day(2026, 3, 8), 'day', LA);
    expect(start.toISOString()).toBe('2026-03-08T08:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-09T07:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(23 * 60 * 60 * 1000);
  });
});

describe('getEventsCount', () => {
  // The real Citrus and Sage bookings for Thursday 20 August 2026, as stored
  // after the repair: 9:00 AM and 4:00 PM Los_Angeles time.
  const morning = event('9am', '2026-08-20T16:00:00Z', '2026-08-20T16:15:00Z');
  const afternoon = event(
    '4pm',
    '2026-08-20T23:00:00Z',
    '2026-08-20T23:15:00Z'
  );

  // 11:00 PM in Los_Angeles on the 20th is 06:00Z on the 21st: it belongs to
  // the org's Thursday but to UTC's Friday. This is the case that discriminates
  // inside a UTC-pinned runner — a browser-local window misses it.
  const lateNight = event(
    '11pm',
    '2026-08-21T06:00:00Z',
    '2026-08-21T06:30:00Z'
  );

  it('counts every booking on the org day, including one past UTC midnight', () => {
    expect(
      getEventsCount(
        [morning, afternoon, lateNight],
        day(2026, 8, 20),
        'day',
        LA
      )
    ).toBe(3);
  });

  it('does not count the org’s late-night booking as the next org day', () => {
    expect(getEventsCount([lateNight], day(2026, 8, 21), 'day', LA)).toBe(0);
  });

  it('does not leak the afternoon booking into the next org day', () => {
    expect(
      getEventsCount([morning, afternoon], day(2026, 8, 21), 'day', LA)
    ).toBe(0);
  });

  it('counts the same events differently for a week view spanning the month end', () => {
    // 30 Aug 2026 (Sun) -> 5 Sep. None of the 20 Aug bookings fall in it.
    expect(
      getEventsCount([morning, afternoon], day(2026, 8, 30), 'week', LA)
    ).toBe(0);
  });

  it('would have filed the 4pm booking under tomorrow in the viewer’s zone', () => {
    // Documents the bug: viewed as Dublin days, the 23:00Z booking belongs to
    // the 21st and the 20th shows only one event. This is what the operator saw.
    expect(
      getEventsCount([morning, afternoon], day(2026, 8, 20), 'day', DUBLIN)
    ).toBe(1);
    expect(
      getEventsCount([morning, afternoon], day(2026, 8, 21), 'day', DUBLIN)
    ).toBe(1);
  });

  it('counts an event starting exactly at the org midnight boundary', () => {
    const midnight = event(
      '12am',
      '2026-08-20T07:00:00Z',
      '2026-08-20T08:00:00Z'
    );
    expect(getEventsCount([midnight], day(2026, 8, 20), 'day', LA)).toBe(1);
    expect(getEventsCount([midnight], day(2026, 8, 19), 'day', LA)).toBe(0);
  });
});

describe('getMonthCellEvents', () => {
  // 4:00 PM Los_Angeles on Thursday 20 August 2026.
  const afternoon = event(
    '4pm',
    '2026-08-20T23:00:00Z',
    '2026-08-20T23:15:00Z'
  );

  it('puts the booking in the org’s day cell', () => {
    const cell = getMonthCellEvents(day(2026, 8, 20), [afternoon], {}, LA);
    expect(cell.map((e) => e.id)).toEqual(['4pm']);
  });

  it('does not also put it in the next cell', () => {
    const cell = getMonthCellEvents(day(2026, 8, 21), [afternoon], {}, LA);
    expect(cell).toHaveLength(0);
  });

  it('fills every cell a multi-day event spans in the org zone', () => {
    // 11:30 PM Thu -> 12:30 AM Fri in Los_Angeles: two org days, but a single
    // mid-morning span in UTC.
    const overnight = event(
      'overnight',
      '2026-08-21T06:30:00Z',
      '2026-08-21T07:30:00Z'
    );
    expect(
      getMonthCellEvents(day(2026, 8, 20), [overnight], {}, LA)
    ).toHaveLength(1);
    expect(
      getMonthCellEvents(day(2026, 8, 21), [overnight], {}, LA)
    ).toHaveLength(1);
    expect(
      getMonthCellEvents(day(2026, 8, 22), [overnight], {}, LA)
    ).toHaveLength(0);
  });
});
