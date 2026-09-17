import { describe, expect, it } from '@borradh-workspace/testing';
import {
  createSeededRng,
  deriveRng,
  hashStr,
  pickIntInclusive,
  pickN,
  pickOne,
} from './seeded-rng.js';

describe('seeded-rng', () => {
  describe('createSeededRng', () => {
    it('produces the same sequence for the same seed', () => {
      const rngA = createSeededRng(42);
      const rngB = createSeededRng(42);
      const seqA = Array.from({ length: 10 }, () => rngA());
      const seqB = Array.from({ length: 10 }, () => rngB());
      expect(seqA).toEqual(seqB);
    });

    it('produces different sequences for different seeds', () => {
      const rngA = createSeededRng(42);
      const rngB = createSeededRng(43);
      const seqA = Array.from({ length: 10 }, () => rngA());
      const seqB = Array.from({ length: 10 }, () => rngB());
      expect(seqA).not.toEqual(seqB);
    });

    it('produces values in [0, 1)', () => {
      const rng = createSeededRng(12345);
      for (let i = 0; i < 100; i++) {
        const v = rng();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });
  });

  describe('hashStr', () => {
    it('returns the same hash for the same input', () => {
      expect(hashStr('hello')).toBe(hashStr('hello'));
    });

    it('returns different hashes for different inputs', () => {
      expect(hashStr('hello')).not.toBe(hashStr('world'));
    });

    it('returns a 32-bit unsigned integer', () => {
      const h = hashStr('any-string-value');
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(0x100000000);
    });
  });

  describe('deriveRng', () => {
    it('produces stable picks for the same (seed, key) pair', () => {
      const a = deriveRng(7, 'broll.clips');
      const b = deriveRng(7, 'broll.clips');
      expect(a()).toBe(b());
    });

    it('produces independent streams for different keys', () => {
      const a = deriveRng(7, 'broll.clips');
      const b = deriveRng(7, 'music');
      // Extremely unlikely to collide on the first three draws.
      const seqA = [a(), a(), a()];
      const seqB = [b(), b(), b()];
      expect(seqA).not.toEqual(seqB);
    });
  });

  describe('pickIntInclusive', () => {
    it('always returns min when min === max', () => {
      const rng = createSeededRng(1);
      for (let i = 0; i < 20; i++) {
        expect(pickIntInclusive(rng, 4, 4)).toBe(4);
      }
    });

    it('returns deterministic counts across runs', () => {
      const rngA = createSeededRng(99);
      const rngB = createSeededRng(99);
      const seqA = Array.from({ length: 20 }, () =>
        pickIntInclusive(rngA, 1, 4)
      );
      const seqB = Array.from({ length: 20 }, () =>
        pickIntInclusive(rngB, 1, 4)
      );
      expect(seqA).toEqual(seqB);
      for (const v of seqA) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(4);
      }
    });

    it('throws when max < min', () => {
      const rng = createSeededRng(1);
      expect(() => pickIntInclusive(rng, 5, 4)).toThrow();
    });
  });

  describe('pickN', () => {
    it('returns the same picks across runs for the same seed', () => {
      const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
      const rngA = createSeededRng(123);
      const rngB = createSeededRng(123);
      expect(pickN(rngA, items, 3)).toEqual(pickN(rngB, items, 3));
    });

    it('does not mutate the input list', () => {
      const items = ['a', 'b', 'c'];
      const original = items.slice();
      const rng = createSeededRng(1);
      pickN(rng, items, 2);
      expect(items).toEqual(original);
    });

    it('clamps n to the list length', () => {
      const items = ['a', 'b'];
      const rng = createSeededRng(1);
      const picked = pickN(rng, items, 10);
      expect(picked.length).toBe(2);
      expect(new Set(picked)).toEqual(new Set(items));
    });

    it('returns an empty array for empty input', () => {
      const rng = createSeededRng(1);
      expect(pickN(rng, [], 3)).toEqual([]);
    });
  });

  describe('pickOne', () => {
    it('returns the same pick across runs for the same seed', () => {
      const items = ['a', 'b', 'c', 'd', 'e'];
      const rngA = createSeededRng(7);
      const rngB = createSeededRng(7);
      expect(pickOne(rngA, items)).toBe(pickOne(rngB, items));
    });

    it('throws on empty list', () => {
      const rng = createSeededRng(1);
      expect(() => pickOne(rng, [])).toThrow();
    });
  });

  describe('integration: deterministic asset selection', () => {
    // Stand-in for the gate's selection logic — same shape as the asset-clips
    // resolver, but with a list of strings so the test has no DB dep.
    const simulateGatePick = (
      seed: number,
      slotId: string,
      assetIds: readonly string[],
      countRange: [number, number]
    ) => {
      const rng = deriveRng(seed, slotId);
      const count = pickIntInclusive(rng, countRange[0], countRange[1]);
      return { count, picked: pickN(rng, assetIds, count) };
    };

    const assets = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'];

    it('produces byte-identical picks across two runs with the same seed', () => {
      const run1 = simulateGatePick(424242, 'broll.clips', assets, [1, 4]);
      const run2 = simulateGatePick(424242, 'broll.clips', assets, [1, 4]);
      expect(run1).toEqual(run2);
    });

    it('produces different picks for different seeds', () => {
      // Probabilistic: with 8 assets and count in [1, 4] there are many
      // possible outcomes, so two random seeds should diverge for at least
      // one of {count, picked}. We sample multiple seeds to keep the test
      // deterministic.
      const a = simulateGatePick(1, 'broll.clips', assets, [1, 4]);
      const b = simulateGatePick(2, 'broll.clips', assets, [1, 4]);
      const c = simulateGatePick(3, 'broll.clips', assets, [1, 4]);
      // At least one of the pairs should differ.
      const allEqual =
        JSON.stringify(a) === JSON.stringify(b) &&
        JSON.stringify(b) === JSON.stringify(c);
      expect(allEqual).toBe(false);
    });

    it('two different slots with the same seed pick independently', () => {
      const brollA = simulateGatePick(99, 'broll.clips', assets, [2, 2]);
      const brollB = simulateGatePick(99, 'broll.clips', assets, [2, 2]);
      const outroA = simulateGatePick(99, 'outro.media', assets, [2, 2]);
      // Same slot, same seed → same pick.
      expect(brollA).toEqual(brollB);
      // Different slot, same seed → MUST be independently seeded (different
      // pick, almost certainly).
      expect(brollA.picked).not.toEqual(outroA.picked);
    });
  });
});
