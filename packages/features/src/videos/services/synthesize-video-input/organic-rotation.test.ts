import { describe, expect, it } from '@borradh-workspace/testing';
import { rotateTemplateSlugs } from '../../../image-generation/index.js';
import { ORGANIC_TEMPLATE_IDS } from '../../templates/index.js';

/**
 * Organic videos rotate, the way graphics have since the batch planner.
 *
 * The failure this closes: "make me an organic microneedling video" came back
 * as Caption Tease every single time. Nothing was random — the format was
 * chosen by the MODEL from an enum, and a model picks consistently. Fresh
 * topics cannot fix that; the output LOOKS the same regardless of what it says,
 * which is the same thing owners described about graphics as "it looks like
 * last month".
 *
 * These assert the ROTATION CONTRACT rather than the wiring: the service picks
 * `rotateTemplateSlugs(ORGANIC_TEMPLATE_IDS, 1, offset)` where the offset is how
 * many organic videos the org already has.
 */
describe('organic template rotation', () => {
  const pool = [...ORGANIC_TEMPLATE_IDS];

  it('walks a different template each time the org makes one', () => {
    const firstFive = [0, 1, 2, 3, 4].map(
      (offset) => rotateTemplateSlugs(pool, 1, offset)[0]
    );

    expect(new Set(firstFive).size).toBe(5);
  });

  it('has a pool worth rotating through', () => {
    // If this ever drops to one, rotation is a no-op and the "always the same
    // video" complaint comes straight back.
    expect(pool.length).toBeGreaterThan(4);
  });

  it('comes back round rather than running out', () => {
    expect(rotateTemplateSlugs(pool, 1, pool.length)[0]).toBe(pool[0]);
    expect(rotateTemplateSlugs(pool, 1, pool.length + 2)[0]).toBe(pool[2]);
  });

  // A brand-new org has made nothing, and a failed count falls back to 0.
  it('starts at the top of the pool for an org with no videos', () => {
    expect(rotateTemplateSlugs(pool, 1, 0)[0]).toBe(pool[0]);
  });
});
