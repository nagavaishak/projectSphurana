import { z } from 'zod';
import { imageryPolicySchema } from '../../imagery-policy.js';

/**
 * Schema for orchestrating a coherent multi-slide carousel via the
 * nano-banana engine.
 */
export const orchestrateCarouselSchema = z.object({
  organizationId: z.string().min(1, 'organizationId required'),
  serviceId: z.string().min(1, 'serviceId required'),
  /** What the whole post is about. */
  topic: z.string().min(1, 'topic required'),
  /** Number of slides (ignored when a templateSlug fixes the count). */
  slideCount: z.number().int().min(2).max(10).default(5),
  /**
   * Curated carousel template to follow. When set, the post uses that
   * template's slide layouts + copy-specs (slide count comes from the
   * template). When absent, falls back to org-corpus style references.
   */
  templateSlug: z.string().optional(),
  /** Override the image model. */
  model: z.string().optional(),
  brandPrimaryColor: z.string().optional(),
  allowAiImages: z.boolean().default(false),
  sourceAssetIds: z.array(z.string().min(1)).min(1).max(10).optional(),
  /**
   * Whether the curated stock-image tier may fill slots with no matching
   * service media. Defaults true; threaded into every slide's
   * generateBrandedGraphic → resolveSlotImage.
   */
  allowStockImages: z.boolean().default(true),
  /**
   * The imagery policy as ONE named state. When supplied it REPLACES
   * `allowAiImages` / `allowStockImages`, which remain only so existing
   * callers keep working. See `image-generation/imagery-policy.ts`.
   */
  imageryPolicy: imageryPolicySchema.optional(),
  /**
   * Render with NO brand references, even when the org has a good set.
   *
   * Purely an EXPERIMENTAL control. The reference pipeline — durable corpus,
   * gating, palette grouping, selection — has never been compared against its
   * own absence on a good render, and the only run that lacked references got
   * there by accident (a shell bug pointed it at the wrong database). Without a
   * switch, "references off" is not reproducible and the comparison cannot be
   * made honestly.
   */
  suppressBrandReferences: z.boolean().optional(),
  /**
   * Cap how many brand references are passed. Defaults to ONE.
   *
   * The set goes to the model as N separate image inputs labelled "treat these
   * together as the brand's visual system, and keep whatever is consistent
   * between them" — which asks it to extract a common denominator. When the
   * posts have little in common (an org scoring `consistency=0.40` has no
   * single system) it averages unrelated designs, and an average of three
   * things resembles none of them.
   *
   * Measured: three references produced substituted emblems on two of three
   * deck covers and swipe chrome throughout; one reference produced 0 blockers
   * and 4/4 logos on the same org and service. With the design-model directive
   * the single reference is COPIED rather than averaged, which is the point.
   */
  maxBrandReferences: z.number().int().min(0).optional().default(1),
  /**
   * Free-text user change request, applied to every slide's image prompt so a
   * re-rolled carousel honours instructions like "warmer tone" / "bigger logo".
   */
  refinementInstruction: z.string().optional(),
  /**
   * The graphic row these slides belong to — provenance only.
   *
   * Composing is the path a re-roll falls through to when its edit was lost, so
   * these rows are precisely the ones worth being able to find: N `compose`
   * rows against a graphic the owner asked to EDIT is the signature of that
   * failure, and without the id they were unattributable.
   */
  graphicId: z.string().min(1).optional(),
});

/** `z.input`, not `z.infer` — see build-brand-corpus.schema.ts. `slideCount`,
 *  `allowAiImages` and `allowStockImages` all default, and a caller that pins a
 *  `templateSlug` omits `slideCount` on purpose: the template fixes the count. */
export type OrchestrateCarouselInput = z.input<
  typeof orchestrateCarouselSchema
>;
