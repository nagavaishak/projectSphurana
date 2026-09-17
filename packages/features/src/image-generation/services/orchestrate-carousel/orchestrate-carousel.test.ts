import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import {
  orchestrateCarousel,
  shouldRetryWithoutImagery,
  slideImageryArgs,
} from './orchestrate-carousel.service.js';

describe('orchestrateCarousel', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns VALIDATION_ERROR for missing serviceId', async () => {
    await expectResult(
      orchestrateCarousel(
        mockDb as never,
        {
          organizationId: 'org_1',
          topic: 'fat dissolving',
        } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for slideCount below 2', async () => {
    await expectResult(
      orchestrateCarousel(
        mockDb as never,
        {
          organizationId: 'org_1',
          serviceId: 'svc_1',
          topic: 'fat dissolving',
          slideCount: 1,
        } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});

/**
 * A content refusal is deterministic, and it used to be treated as transient.
 *
 * Production: a therapie question slide holding a real body-contouring still,
 * on a body-contouring topic, was refused with `PROHIBITED_CONTENT`. It was
 * re-sent inside the call, then the whole deck was re-rendered by the job —
 * four times, ~28 image calls, no output, surfaced as "Try again". The same
 * slide rendered first time with the subject photograph suppressed, which is
 * what identifies the photo rather than the copy as the trigger.
 */
describe('shouldRetryWithoutImagery', () => {
  it('retries a content refusal', () => {
    expect(
      shouldRetryWithoutImagery(
        ErrorCodes.AI_MODEL_REFUSED,
        'own-then-stock-then-ai'
      )
    ).toBe(true);
  });

  it('does NOT retry when the deck is already text-led', () => {
    // Nothing left to drop — a second identical request would be refused again.
    expect(
      shouldRetryWithoutImagery(ErrorCodes.AI_MODEL_REFUSED, 'text-led')
    ).toBe(false);
  });

  it('does NOT retry other failures', () => {
    // Rate limits, validation and internal errors have their own handling; a
    // blanket retry here would double every one of them.
    for (const code of [
      ErrorCodes.VALIDATION_ERROR,
      ErrorCodes.INTERNAL_ERROR,
      ErrorCodes.NOT_FOUND,
    ]) {
      expect(shouldRetryWithoutImagery(code, 'own-then-stock-then-ai')).toBe(
        false
      );
    }
  });
});

/**
 * NO TWO SLIDES OF A DECK MAY SHOW THE SAME PHOTOGRAPH.
 *
 * Slides render in parallel and cannot see each other, so distinctness has to
 * be decided ONCE for the deck and handed down. That logic lived only in the
 * template path; when briefs moved organic decks onto the corpus path it was
 * silently lost, and a deck shipped with the same legs photo on slides 3 and 4.
 */
describe('slideImageryArgs', () => {
  const pool = ['a', 'b', 'c'];

  it('gives each slide within the pool a DIFFERENT asset', () => {
    const picked = [0, 1, 2].map(
      (i) => slideImageryArgs(pool, i).sourceAssetIds?.[0]
    );
    expect(picked).toEqual(['a', 'b', 'c']);
    expect(new Set(picked).size).toBe(picked.length);
  });

  it('sends slides beyond the pool to stock rather than repeating one', () => {
    // Repeating is the failure being prevented; a stock still is the fallback.
    const beyond = slideImageryArgs(pool, 3);
    expect(beyond.sourceAssetIds).toBeUndefined();
    expect(beyond.preferStockImage).toBe(true);
  });

  it('salts each slide so two stock slides do not land on one still', () => {
    expect(slideImageryArgs(pool, 3).slotRotationSalt).not.toBe(
      slideImageryArgs(pool, 4).slotRotationSalt
    );
  });

  it('asks for stock, not a repeat, when there is no pool at all', () => {
    expect(slideImageryArgs(undefined, 0).sourceAssetIds).toBeUndefined();
  });
});

describe("slideImageryArgs — a refused slide cannot steal a neighbour's photo", () => {
  it("names every OTHER slide's asset as excluded", () => {
    // The refusal retry re-resolves the slot and knows only what this slide was
    // told. Without the rest of the deck named, it falls back to the service
    // pool and can pick a photograph another slide is already showing.
    const args = slideImageryArgs(['a', 'b', 'c'], 1);
    expect(args.sourceAssetIds).toEqual(['b']);
    expect(args.excludeAssetIds).toEqual(['a', 'c']);
  });

  it('excludes the whole pool for a slide beyond it', () => {
    expect(slideImageryArgs(['a', 'b'], 5).excludeAssetIds).toEqual(['a', 'b']);
  });
});
