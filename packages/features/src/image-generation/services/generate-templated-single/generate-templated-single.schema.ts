import { z } from 'zod';
import { imageryPolicySchema } from '../../imagery-policy.js';

/**
 * Offer context for PAID-AD graphics. The LLM composes the badge / treatment /
 * benefit / CTA copy from this — the owner never fills explicit fields. All
 * money fields are integer cents. Only the fields relevant to `discountType`
 * are populated (mirrors the `offer` table's discriminated columns).
 */
export const adGraphicOfferSchema = z.object({
  name: z.string(),
  discountType: z.string(),
  discountPercent: z.number().nullable().optional(),
  discountAmountCents: z.number().nullable().optional(),
  originalPriceCents: z.number().nullable().optional(),
  offerPriceCents: z.number().nullable().optional(),
  /** "New clients only" etc. — surfaced as an audience qualifier. */
  limitPerClient: z.boolean().optional(),
  /** ISO date — drives an optional urgency/"ends" line. */
  validUntil: z.string().nullable().optional(),
});

export type AdGraphicOffer = z.infer<typeof adGraphicOfferSchema>;

/** Generate a single graphic from a curated single-template. */
export const generateTemplatedSingleSchema = z.object({
  organizationId: z.string().min(1, 'organizationId required'),
  serviceId: z.string().min(1, 'serviceId required'),
  topic: z.string().min(1, 'topic required'),
  /** Which single-graphic template to follow. */
  templateSlug: z.string().min(1, 'templateSlug required'),

  /** The `graphic` row this render belongs to — provenance only. */
  graphicId: z.string().min(1).optional(),

  /**
   * The copy currently rendered on the graphic being regenerated.
   *
   * With it the copy writer performs a surgical edit; without it it writes a
   * fresh deck, which is why changing a headline used to rewrite the body and
   * CTA as well.
   */
  priorCopy: z.string().optional(),

  /** What is changing — forwarded to the generator's intent table. */
  regenerationIntent: z.enum(['copy', 'image', 'branding', 'full']).optional(),
  model: z.string().optional(),
  brandPrimaryColor: z.string().optional(),
  allowAiImages: z.boolean().default(false),
  sourceAssetIds: z.array(z.string().min(1)).min(1).max(10).optional(),
  /**
   * Whether the curated stock-image tier may fill the subject slot when the org
   * has no uploaded service media. Defaults true; threaded into
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
  /** organic = social post, ad = paid offer ad (drives copy + region labels). */
  usageType: z.enum(['organic', 'ad']).default('organic'),
  /**
   * Required when usageType='ad' — the offer the ad promotes. The service
   * fetches the offer row by this id and composes the badge/treatment/benefit
   * copy from it (the owner fills no fields).
   */
  offerId: z.string().min(1).optional(),
  /** Free-text user change request — threaded into copy writer + image prompt. */
  refinementInstruction: z.string().optional(),
  /** URL of the previous render, for refinement-aware regeneration. */
  priorImageUrl: z.string().url().optional(),
});

export type GenerateTemplatedSingleInput = z.input<
  typeof generateTemplatedSingleSchema
>;
