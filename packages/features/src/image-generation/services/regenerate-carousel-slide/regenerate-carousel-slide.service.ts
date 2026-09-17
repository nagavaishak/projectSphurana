/**
 * `regenerateCarouselSlide` — re-render a single slide of an existing carousel,
 * refined from its current image.
 *
 * The prior slide image is fed back to the model as the "previous version" so
 * it reproduces that slide's layout, copy and branding and applies ONLY the
 * user's change (e.g. "add a blue tint"). The pinned template's slide layout +
 * the brand logo are passed so the result stays on-template and on-brand.
 *
 * Returns the rendered PNG; the caller (worker) uploads it and splices it into
 * the graphic's existing `outputs[]` at the same slide order.
 */

import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
} from '../../../shared/index.js';
import { ensureLogoVariants } from '../../logo-variants.js';
import {
  type GenerateBrandedGraphicOutput,
  generateBrandedGraphic,
} from '../generate-branded-graphic/index.js';
import {
  type RegenerateCarouselSlideInput,
  regenerateCarouselSlideSchema,
} from './regenerate-carousel-slide.schema.js';

const regenerateCarouselSlideImpl = async (
  db: DbConnection,
  input: RegenerateCarouselSlideInput
): Promise<Result<GenerateBrandedGraphicOutput>> => {
  const parsed = regenerateCarouselSlideSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const {
    organizationId,
    serviceId,
    topic,
    priorImageUrl,
    refinementInstruction,
    model,
    brandPrimaryColor,
    allowAiImages,
    sourceAssetIds,
    allowStockImages,
  } = parsed.data;

  /**
   * NO LAYOUT IS FETCHED, AND NONE IS NEEDED.
   *
   * This used to look up the composition template and pass that slide's
   * `layoutPrompt`, which contradicted the directive sitting three lines below
   * it: refine this slide, keep its composition exactly, change only what was
   * asked. The prior image already fixes the composition — the comment here
   * said so — and handing over a second description of the layout gives the
   * model something to reconcile on a call whose whole point is not to
   * recompose.
   *
   * It was also a failure mode. Decks are built from briefs, which carry no
   * per-slide layouts, so the lookup could only ever return NOT_FOUND for a
   * deck made the way decks are made — refusing to refine a slide because a
   * registry it never used has no entry for it.
   */
  // Share the brand logo polarities.
  const logoVariants = await ensureLogoVariants(db, organizationId);

  return (await generateBrandedGraphic(db, {
    organizationId,
    serviceId,
    topic,
    model,
    brandPrimaryColor,
    allowAiImages,
    sourceAssetIds,
    allowStockImages,
    priorImageUrl,
    refinementInstruction,
    graphicId: input.graphicId,
    priorGraphicId: input.priorGraphicId,
    regenerationIntent: input.regenerationIntent,
    slideIndex: input.slideIndex,
    templateSlug: input.templateSlug,
    provenanceOperation: input.provenanceOperation ?? 'refine-slide',
    logoLightBase64: logoVariants.light?.data,
    logoLightMediaType: logoVariants.light?.mediaType,
    logoDarkBase64: logoVariants.dark?.data,
    logoDarkMediaType: logoVariants.dark?.mediaType,
    renderCopy: input.renderCopy,
    slideDirective:
      'Refine ONLY this single slide. Keep its existing copy, composition and branding exactly; apply only the requested change.',
    // Still one slide of the deck → keep the deck-wide typography lock + shared
    // footer so a re-rolled slide stays consistent with the rest (ENG-542).
    isCarouselSlide: true,
  })) as Result<GenerateBrandedGraphicOutput>;
};

export const regenerateCarouselSlide = (
  db: DbConnection,
  input: RegenerateCarouselSlideInput
) =>
  trackedResult(
    'imageGeneration.regenerateCarouselSlide',
    () => regenerateCarouselSlideImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        templateSlug: input.templateSlug,
        slideIndex: input.slideIndex,
      },
    }
  );

export type RegenerateCarouselSlideResult = Awaited<
  ReturnType<typeof regenerateCarouselSlide>
>;
