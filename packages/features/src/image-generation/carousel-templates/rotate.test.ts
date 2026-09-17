import { describe, expect, it } from '@borradh-workspace/testing';
import { rotateTemplateSlugs } from './rotate.js';

/**
 * Template selection was `hash(graphicId) % poolSize` with a random UUID —
 * uniform random, no memory. With six organic single templates that meant
 * repeated designs within any batch larger than six, and a fresh random draw
 * on every regenerate. Owners read that as "it looks like last month" even
 * when every word of the copy is new.
 */
const POOL = ['a', 'b', 'c', 'd', 'e', 'f'];

describe('rotateTemplateSlugs', () => {
  it('gives consecutive positions different designs', () => {
    const slugs = rotateTemplateSlugs(POOL, 6, 0);
    expect(new Set(slugs).size).toBe(6);
  });

  it('walks the pool in order from the offset', () => {
    expect(rotateTemplateSlugs(POOL, 3, 2)).toEqual(['c', 'd', 'e']);
  });

  it('moves the next batch on so it does not reopen on the same design', () => {
    // The regression: two batches in a row starting from the same layout.
    const first = rotateTemplateSlugs(POOL, 4, 0);
    const second = rotateTemplateSlugs(POOL, 4, 4);
    expect(second[0]).not.toBe(first[0]);
  });

  it('wraps once the pool is exhausted', () => {
    // Unavoidable past pool size — but it repeats in a predictable cycle
    // rather than clustering randomly.
    const slugs = rotateTemplateSlugs(POOL, 8, 0);
    expect(slugs.slice(0, 6)).toEqual(POOL);
    expect(slugs.slice(6)).toEqual(['a', 'b']);
  });

  it('wraps the offset itself', () => {
    expect(rotateTemplateSlugs(POOL, 2, 7)).toEqual(['b', 'c']);
  });

  it('tolerates a nonsense offset rather than producing undefined slots', () => {
    // A failed count returns 0, but guard the modulo anyway — an undefined
    // slug would reach the worker and fail the render.
    expect(rotateTemplateSlugs(POOL, 2, -5)).toEqual(['a', 'b']);
    expect(rotateTemplateSlugs(POOL, 2, Number.NaN)).toEqual(['a', 'b']);
  });

  it('returns nothing for an empty pool or zero count', () => {
    expect(rotateTemplateSlugs([], 3, 0)).toEqual([]);
    expect(rotateTemplateSlugs(POOL, 0, 0)).toEqual([]);
  });
});
