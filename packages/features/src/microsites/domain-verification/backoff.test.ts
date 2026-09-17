import { describe, expect, it } from '@borradh-workspace/testing';
import {
  hasExhaustedVerification,
  isDueForVerification,
  nextVerificationDelayMs,
} from './backoff.js';
import {
  VERIFY_BACKOFF_MAX_MS,
  VERIFY_GIVE_UP_MS,
} from './domain-verification.constants.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe('nextVerificationDelayMs', () => {
  it('polls every 30s while the tenant is still watching the screen', () => {
    expect(nextVerificationDelayMs(0)).toBe(30_000);
    expect(nextVerificationDelayMs(9 * MINUTE)).toBe(30_000);
  });

  it('steps out to 2 minutes, then 5, as the wait gets long', () => {
    expect(nextVerificationDelayMs(10 * MINUTE)).toBe(2 * MINUTE);
    expect(nextVerificationDelayMs(59 * MINUTE)).toBe(2 * MINUTE);
    expect(nextVerificationDelayMs(1 * HOUR)).toBe(5 * MINUTE);
    expect(nextVerificationDelayMs(5 * HOUR)).toBe(5 * MINUTE);
  });

  it('plateaus at 15 minutes and never goes higher', () => {
    expect(nextVerificationDelayMs(6 * HOUR)).toBe(VERIFY_BACKOFF_MAX_MS);
    expect(nextVerificationDelayMs(6 * 24 * HOUR)).toBe(VERIFY_BACKOFF_MAX_MS);
  });
});

describe('hasExhaustedVerification', () => {
  it('is false right up to 7 days and true at it', () => {
    expect(hasExhaustedVerification(VERIFY_GIVE_UP_MS - 1)).toBe(false);
    expect(hasExhaustedVerification(VERIFY_GIVE_UP_MS)).toBe(true);
  });
});

describe('isDueForVerification', () => {
  const now = new Date('2026-01-08T00:00:00Z');

  it('is due immediately when it has never been checked', () => {
    expect(
      isDueForVerification({
        createdAt: new Date('2026-01-07T23:59:59Z'),
        lastCheckedAt: null,
        now,
      })
    ).toBe(true);
  });

  it('is not due inside the current rung', () => {
    expect(
      isDueForVerification({
        createdAt: new Date('2026-01-07T23:55:00Z'), // 5 min old → 30s rung
        lastCheckedAt: new Date('2026-01-07T23:59:50Z'), // 10s ago
        now,
      })
    ).toBe(false);
  });

  it('is due once the rung has elapsed', () => {
    expect(
      isDueForVerification({
        createdAt: new Date('2026-01-07T23:55:00Z'),
        lastCheckedAt: new Date('2026-01-07T23:59:20Z'), // 40s ago
        now,
      })
    ).toBe(true);
  });

  it('is due once exhausted even if it was just checked — the give-up is owed work', () => {
    expect(
      isDueForVerification({
        createdAt: new Date('2026-01-01T00:00:00Z'), // 7 days
        lastCheckedAt: new Date('2026-01-07T23:59:59Z'),
        now,
      })
    ).toBe(true);
  });
});
