import { z } from 'zod';

/**
 * Re-render ONE slide of an existing carousel, refined from its current image.
 * Keeps the slide's layout + copy (the prior image carries them) and applies
 * only the user's change; the other slides are left untouched by the caller.
 */
export const regenerateCarouselSlideSchema = z.object({
  organizationId: z.string().min(1, 'organizationId required'),
  serviceId: z.string().min(1, 'serviceId required'),
  topic: z.string().min(1, 'topic required'),
  /**
   * The style the deck was pinned to, if any — PROVENANCE ONLY.
   *
   * This was required, and was used to look up a composition template so the
   * slide's `layoutPrompt` could be re-sent. Decks are built from briefs and
   * carry no per-slide layouts, so that lookup could only fail; the prior image
   * is the composition. A deck with no pin must still be refinable, so the
   * field is optional and is forwarded for provenance rather than resolved.
   */
  templateSlug: z.string().min(1).optional(),
  /**
   * The words this slide already carries, pinned so a correction cannot
   * rewrite them. When absent the render falls back to `topic`, which for a
   * carousel is the DECK's subject and not this slide's.
   */
  renderCopy: z.object({ heading: z.string(), body: z.string() }).optional(),
  /** 0-based index of the slide to refine. */
  slideIndex: z.number().int().min(0),
  /**
   * The graphic row this slide belongs to, and why it is being rendered —
   * provenance only. Without them a deck's rows are indistinguishable from one
   * another and from a full recompose.
   */
  graphicId: z.string().min(1).optional(),
  /** The graphic being amended — pins its photo so an edit cannot swap it. */
  priorGraphicId: z.string().min(1).optional(),
  /** Stated, not inferred. See `regeneration-intent.ts`. */
  regenerationIntent: z.enum(['copy', 'image', 'branding', 'full']).optional(),
  provenanceOperation: z
    .enum(['compose', 'refine-slide', 'refine-deck'])
    .optional(),
  /** URL of that slide's current render — anchored as the "previous version". */
  priorImageUrl: z.string().url(),
  /** The user's change request (e.g. "add a subtle blue tint"). */
  refinementInstruction: z.string().min(1, 'refinementInstruction required'),
  model: z.string().optional(),
  brandPrimaryColor: z.string().optional(),
  allowAiImages: z.boolean().default(false),
  sourceAssetIds: z.array(z.string().min(1)).length(1).optional(),
  /**
   * Whether the curated stock-image tier may fill the subject slot when the org
   * has no uploaded service media. Defaults true; threaded into
   * generateBrandedGraphic → resolveSlotImage.
   */
  allowStockImages: z.boolean().default(true),
});

export type RegenerateCarouselSlideInput = z.infer<
  typeof regenerateCarouselSlideSchema
>;
