import { describe, expect, it } from '@borradh-workspace/testing';
import {
  DEFAULT_NUDGE_POLICY,
  type NudgeOwnerSignals,
  decideNudge,
  isWithinQuietHours,
} from './nudge-conditions.js';

const base: NudgeOwnerSignals = {
  organizationId: 'org-1',
  userId: 'user-1',
  phoneE164: '353871234567',
  optedOut: false,
  lastNudgeAt: null,
  usageToday: 0,
  usageDailyCap: 100,
  candidate: { template: 'daily_lead_recap', params: ['5'] },
};

// Midday on a fixed date — well inside the allowed window.
const NOON = new Date('2026-06-11T12:00:00Z');
const NOON_HOUR = 12;

describe('isWithinQuietHours', () => {
  it('is quiet before 09:00 and at/after 20:00 (defaults)', () => {
    expect(isWithinQuietHours(8, DEFAULT_NUDGE_POLICY)).toBe(true);
    expect(isWithinQuietHours(20, DEFAULT_NUDGE_POLICY)).toBe(true);
    expect(isWithinQuietHours(23, DEFAULT_NUDGE_POLICY)).toBe(true);
  });
  it('is allowed during the day', () => {
    expect(isWithinQuietHours(9, DEFAULT_NUDGE_POLICY)).toBe(false);
    expect(isWithinQuietHours(12, DEFAULT_NUDGE_POLICY)).toBe(false);
    expect(isWithinQuietHours(19, DEFAULT_NUDGE_POLICY)).toBe(false);
  });
});

describe('decideNudge', () => {
  it('sends when all gates pass', () => {
    const d = decideNudge(base, NOON, NOON_HOUR);
    expect(d.send).toBe(true);
    if (d.send) expect(d.candidate.template).toBe('daily_lead_recap');
  });

  it('skips opted-out owners (highest priority)', () => {
    const d = decideNudge({ ...base, optedOut: true }, NOON, NOON_HOUR);
    expect(d).toEqual({ send: false, reason: 'opted_out' });
  });

  it('skips when there is no candidate', () => {
    const d = decideNudge({ ...base, candidate: null }, NOON, NOON_HOUR);
    expect(d).toEqual({ send: false, reason: 'no_candidate' });
  });

  it('skips during quiet hours', () => {
    const d = decideNudge(base, new Date('2026-06-11T03:00:00Z'), 3);
    expect(d).toEqual({ send: false, reason: 'quiet_hours' });
  });

  it('skips when within the frequency cap window', () => {
    // Last nudge 2 hours ago — under the 20h minimum.
    const lastNudgeAt = new Date(NOON.getTime() - 2 * 60 * 60 * 1000);
    const d = decideNudge({ ...base, lastNudgeAt }, NOON, NOON_HOUR);
    expect(d).toEqual({ send: false, reason: 'frequency_cap' });
  });

  it('sends once the frequency window has elapsed', () => {
    const lastNudgeAt = new Date(NOON.getTime() - 21 * 60 * 60 * 1000);
    const d = decideNudge({ ...base, lastNudgeAt }, NOON, NOON_HOUR);
    expect(d.send).toBe(true);
  });

  it('skips when the org is at/over its daily usage cap', () => {
    const d = decideNudge(
      { ...base, usageToday: 100, usageDailyCap: 100 },
      NOON,
      NOON_HOUR
    );
    expect(d).toEqual({ send: false, reason: 'usage_cap' });
  });

  it('a zero usage cap does not block (treated as no cap)', () => {
    const d = decideNudge(
      { ...base, usageToday: 5, usageDailyCap: 0 },
      NOON,
      NOON_HOUR
    );
    expect(d.send).toBe(true);
  });
});
