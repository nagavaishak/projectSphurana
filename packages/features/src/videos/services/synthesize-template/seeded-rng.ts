/**
 * Seeded deterministic RNG helpers for synthesis.
 *
 * Same seed + same inputs → byte-identical asset / music / count picks. This
 * is the foundation of §10 invariant 3 (deterministic synthesis): we never
 * call `Math.random()` or `Date.now()` downstream of a seed.
 *
 * The implementation is mulberry32 — a 32-bit hash-based PRNG with good
 * scatter for our small selection problems (clip counts in `[1, 4]`,
 * tie-breaking between a handful of equally-ranked music tracks). It's pure,
 * dependency-free, and stable across Node versions.
 */

export type SeededRng = () => number;

/**
 * Construct a deterministic RNG from a 32-bit seed.
 * Returns a function that, when called, yields a float in `[0, 1)`.
 */
export function createSeededRng(seed: number): SeededRng {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Tiny djb2 string hash → 32-bit unsigned integer.
 * Used to derive per-slot sub-seeds from the root seed + the slot id, so the
 * order in which slots are processed doesn't change other slots' picks.
 */
export function hashStr(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return h >>> 0;
}

/**
 * Derive a sub-RNG that's deterministic in `(seed, key)` but independent of
 * any other sub-RNG. Use this for every slot/decision point so adding or
 * reordering slots doesn't perturb existing picks.
 */
export function deriveRng(seed: number, key: string): SeededRng {
  return createSeededRng((seed ^ hashStr(key)) >>> 0);
}

/**
 * Pick an inclusive integer in `[min, max]` deterministically from the RNG.
 */
export function pickIntInclusive(
  rng: SeededRng,
  min: number,
  max: number
): number {
  if (max < min) {
    throw new Error(`pickIntInclusive: max (${max}) < min (${min})`);
  }
  return min + Math.floor(rng() * (max - min + 1));
}

/**
 * Pick `n` items from `items` deterministically using a partial Fisher-Yates
 * shuffle. When `n >= items.length`, returns all items in shuffled order.
 */
export function pickN<T>(rng: SeededRng, items: readonly T[], n: number): T[] {
  const arr = items.slice();
  const k = Math.min(n, arr.length);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rng() * (arr.length - i));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr.slice(0, k);
}

/**
 * Pick a single item deterministically from a non-empty list.
 */
export function pickOne<T>(rng: SeededRng, items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error('pickOne: cannot pick from an empty list');
  }
  return items[Math.floor(rng() * items.length)];
}

/**
 * Generate a fresh non-cryptographic 32-bit seed when the caller didn't
 * supply one. We persist whatever we generated on the video row so retries
 * replay the same picks.
 */
export function generateSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}
