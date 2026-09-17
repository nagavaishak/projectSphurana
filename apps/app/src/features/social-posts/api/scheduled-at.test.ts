import { describe, expect, it } from 'vitest';
import { scheduledAtFromDateTime } from './scheduled-at';

/**
 * Regression guard for ENG-738. A scheduled post's `yyyy-MM-dd` + `HH:mm` is a
 * wall-clock in the BUSINESS timezone, not the scheduler's device. The previous
 * `new Date(date).setHours(...)` read the browser zone, so "09:00" stored a
 * different instant depending on where the laptop was. These pin the conversion
 * to the org zone.
 */
describe('scheduledAtFromDateTime', () => {
  const DATE = '2026-08-20'; // August → LA is PDT (UTC-7), Dublin is IST (UTC+1)
  const TIME = '09:00';

  it('interprets the wall-clock in the business zone, not UTC', () => {
    // 09:00 in Los Angeles (PDT, UTC-7) is 16:00 UTC.
    expect(scheduledAtFromDateTime(DATE, TIME, 'America/Los_Angeles')).toBe(
      '2026-08-20T16:00:00.000Z'
    );
    // 09:00 in Dublin (IST, UTC+1) is 08:00 UTC.
    expect(scheduledAtFromDateTime(DATE, TIME, 'Europe/Dublin')).toBe(
      '2026-08-20T08:00:00.000Z'
    );
  });

  it('passes UTC wall-clocks straight through', () => {
    expect(scheduledAtFromDateTime(DATE, TIME, 'UTC')).toBe(
      '2026-08-20T09:00:00.000Z'
    );
  });

  it('the same wall-clock in two zones yields different instants (the bug)', () => {
    const la = scheduledAtFromDateTime(DATE, TIME, 'America/Los_Angeles');
    const dublin = scheduledAtFromDateTime(DATE, TIME, 'Europe/Dublin');
    expect(la).not.toBe(dublin);
  });
});
