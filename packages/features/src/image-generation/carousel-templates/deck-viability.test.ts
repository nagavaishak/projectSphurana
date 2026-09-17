import { describe, expect, it } from '@borradh-workspace/testing';
import { isDeckViable } from '../services/orchestrate-carousel/orchestrate-carousel.service.js';

/**
 * A deck must survive a bad slide.
 *
 * One slide refused on content safety discarded six finished slides in
 * production, four times over, because both assembly loops were
 * `if (!r.success) return err(...)`.
 */
describe('isDeckViable', () => {
  it('keeps a deck that lost one middle slide', () => {
    expect(isDeckViable([0, 1, 2, 4, 5])).toBe(true);
  });

  it('rejects a deck with no cover', () => {
    // The cover is the anchor every other slide was rendered against, and the
    // only slide most people see. A deck missing it is a different deck.
    expect(isDeckViable([1, 2, 3, 4, 5])).toBe(false);
  });

  it('rejects a deck below the floor', () => {
    expect(isDeckViable([0, 1])).toBe(false);
    expect(isDeckViable([0])).toBe(false);
    expect(isDeckViable([])).toBe(false);
  });

  it('accepts exactly the floor', () => {
    expect(isDeckViable([0, 1, 2])).toBe(true);
  });
});
