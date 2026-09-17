import { describe, expect, it } from '@borradh-workspace/testing';
import { giftCardExpiryToDate } from './gift-card-expiry.js';

describe('giftCardExpiryToDate', () => {
  // Local-time anchor so the calendar-aware setDate/setMonth/setFullYear
  // arithmetic (which operates in the server's local zone) is tz-consistent.
  const from = new Date(2026, 6, 6, 12, 0, 0); // 2026-07-06 12:00 local

  it('returns null for never (no expiry)', () => {
    expect(giftCardExpiryToDate('never', from)).toBeNull();
  });

  it('adds days for a day-based expiry', () => {
    const result = giftCardExpiryToDate('14d', from);
    expect(result?.getFullYear()).toBe(2026);
    expect(result?.getMonth()).toBe(6); // July
    expect(result?.getDate()).toBe(20);
  });

  it('adds calendar months for a month-based expiry', () => {
    const result = giftCardExpiryToDate('1m', from);
    expect(result?.getMonth()).toBe(7); // August (0-indexed)
    expect(result?.getDate()).toBe(6);
  });

  it('adds calendar years for a year-based expiry', () => {
    expect(giftCardExpiryToDate('2y', from)?.getFullYear()).toBe(2028);
    expect(giftCardExpiryToDate('5y', from)?.getFullYear()).toBe(2031);
  });

  it('does not mutate the input date', () => {
    const original = from.getTime();
    giftCardExpiryToDate('6m', from);
    expect(from.getTime()).toBe(original);
  });
});
