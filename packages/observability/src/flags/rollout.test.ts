import { describe, expect, it } from 'vitest';
import { isInRollout, rolloutBucket } from './rollout.js';

const ids = (n: number, prefix = 'user_'): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe('isInRollout', () => {
  it('is deterministic — same input yields same result across calls', () => {
    const a = isInRollout('flag-a', 'user_42', 30);
    const b = isInRollout('flag-a', 'user_42', 30);
    const c = isInRollout('flag-a', 'user_42', 30);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('0% includes nobody', () => {
    for (const id of ids(500)) {
      expect(isInRollout('flag-x', id, 0)).toBe(false);
    }
  });

  it('100% includes everybody', () => {
    for (const id of ids(500)) {
      expect(isInRollout('flag-x', id, 100)).toBe(true);
    }
  });

  it('is monotonic — a unit in at 10% is in at 50% (and at 100%)', () => {
    const inAt10 = ids(2000).filter((id) => isInRollout('ramp', id, 10));
    expect(inAt10.length).toBeGreaterThan(0); // sanity: 10% isn't empty
    for (const id of inAt10) {
      expect(isInRollout('ramp', id, 50)).toBe(true);
      expect(isInRollout('ramp', id, 100)).toBe(true);
    }
  });

  it('ramp only adds units — never removes them as % increases', () => {
    const pcts = [0, 5, 10, 25, 50, 75, 90, 100];
    const cohorts = pcts.map(
      (p) => new Set(ids(1000).filter((id) => isInRollout('ramp2', id, p)))
    );
    for (let i = 1; i < cohorts.length; i++) {
      const prev = cohorts[i - 1];
      const next = cohorts[i];
      // every member of the smaller ramp is still present in the larger ramp
      for (const id of prev) {
        expect(next.has(id)).toBe(true);
      }
      expect(next.size).toBeGreaterThanOrEqual(prev.size);
    }
  });

  it('distributes roughly uniformly — ~50% of 1000 ids at 50% (±10%)', () => {
    const inCount = ids(1000).filter((id) => isInRollout('uni', id, 50)).length;
    // Within ±10 percentage points of half (i.e. 400..600 of 1000).
    expect(inCount).toBeGreaterThanOrEqual(400);
    expect(inCount).toBeLessThanOrEqual(600);
  });

  it('buckets the same unit differently across distinct flags (independent cohorts)', () => {
    // Over many ids, the per-flag bucket should not be identical for both flags
    // for (nearly) all of them — i.e. the flag key actually salts the hash.
    const same = ids(1000).filter(
      (id) => rolloutBucket('flag-one', id) === rolloutBucket('flag-two', id)
    ).length;
    // ~1% collide by chance (same bucket out of 100); assert it's a small slice.
    expect(same).toBeLessThan(100);
  });

  it('treats missing/empty unitId as out-of-rollout (safe default)', () => {
    expect(isInRollout('flag', '', 100)).toBe(false);
    expect(isInRollout('flag', '', 50)).toBe(false);
  });

  it('handles non-integer / out-of-range percentages by clamping', () => {
    // Negative clamps to 0 (nobody); >100 clamps to 100 (everybody).
    expect(isInRollout('flag', 'user_1', -10)).toBe(false);
    expect(isInRollout('flag', 'user_1', 250)).toBe(true);
    // Non-finite is rejected as out-of-rollout.
    expect(isInRollout('flag', 'user_1', Number.NaN)).toBe(false);
  });
});

describe('rolloutBucket', () => {
  it('always returns an integer in 0..99', () => {
    for (const id of ids(500)) {
      const b = rolloutBucket('flag', id);
      expect(Number.isInteger(b)).toBe(true);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(99);
    }
  });
});
