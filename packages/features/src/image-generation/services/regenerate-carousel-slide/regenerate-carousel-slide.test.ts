import {
  createMockDatabase,
  describe,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { regenerateCarouselSlideSchema } from './regenerate-carousel-slide.schema.js';
import { regenerateCarouselSlide } from './regenerate-carousel-slide.service.js';

const validBase = {
  organizationId: 'org_1',
  serviceId: 'svc_1',
  topic: 'Glow up',
  slideIndex: 0,
  priorImageUrl: 'https://cdn/prev.png',
  refinementInstruction: 'add a subtle blue tint',
};

describe('regenerateCarouselSlide validation', () => {
  const mockDb = createMockDatabase();

  it('rejects a missing refinementInstruction', async () => {
    await expectResult(
      regenerateCarouselSlide(
        mockDb as never,
        {
          ...validBase,
          templateSlug: 'whatever',
          refinementInstruction: '',
        } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('rejects a non-url priorImageUrl', async () => {
    await expectResult(
      regenerateCarouselSlide(
        mockDb as never,
        {
          ...validBase,
          templateSlug: 'whatever',
          priorImageUrl: 'not-a-url',
        } as never
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  /**
   * The style is PROVENANCE now, not a lookup key.
   *
   * This block used to assert NOT_FOUND for an unknown slug, because the
   * service resolved it in the composition registry to re-send that slide's
   * `layoutPrompt`. Decks are built from briefs and carry no per-slide layouts,
   * so that lookup could only ever fail — refusing to refine a slide because a
   * registry the deck never used has no entry for it. Refinement anchors to the
   * prior image, which already fixes the composition.
   *
   * Asserted on the schema rather than the service: the contract that changed
   * is what the input may be, and going through the service would exercise a
   * database this block does not stub.
   */
  it('accepts an unrecognised style', () => {
    expect(
      regenerateCarouselSlideSchema.safeParse({
        ...validBase,
        templateSlug: 'definitely-not-a-real-template-slug',
      }).success
    ).toBe(true);
  });

  it('accepts a slide with no pinned style at all', () => {
    const { templateSlug: _dropped, ...noPin } = validBase;
    expect(regenerateCarouselSlideSchema.safeParse(noPin).success).toBe(true);
  });
});
