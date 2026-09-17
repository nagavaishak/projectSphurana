import type { GraphicCategory } from '@borradh-workspace/api-client/types';
import { z } from 'zod';

/**
 * The typed INTENT for generating a graphic. Every surface (new-post-dialog,
 * generate-graphic-dialog / gallery-new wizard) passes this; only
 * {@link buildGenerateGraphicPayload} turns it into the wire body.
 */
export const generateGraphicInputSchema = z.object({
  serviceId: z.string(),
  category: z.custom<GraphicCategory>().optional(),
  kind: z.enum(['single', 'carousel']).optional(),
  topicSummary: z.string().optional(),
  /**
   * Opt into AI-generated images for slots with no matching service media.
   * Defaults to false server-side — graphics use the service's uploaded
   * photos/clips unless the user explicitly toggles AI on.
   */
  allowAiImages: z.boolean().optional(),
  /**
   * Opt into curated stock photos for slots with no matching service media.
   * Defaults to true server-side — when off, graphics with no uploaded photo
   * skip stock fill and fall back to the template's default image.
   */
  allowStockImages: z.boolean().optional(),
  /** Uploaded image ids explicitly chosen as subject imagery. */
  sourceAssetIds: z.array(z.string()).optional(),
  /**
   * organic = social post (default), ad = paid offer ad. When 'ad', `offerId`
   * is required — the server composes the badge/treatment/benefit copy from
   * the offer.
   */
  usageType: z.enum(['organic', 'ad']).optional(),
  /** Required when usageType='ad' — the offer the ad promotes. */
  offerId: z.string().optional(),
  /** Optional free-text instruction to steer the generated graphic. */
  refinementInstruction: z.string().optional(),
  /**
   * The item this content was proposed under, when a card proposed it before it
   * existed. Fills that proposal instead of opening a second item.
   */
  itemId: z.string().optional(),
  /**
   * Optional curated style (template slug from `GET /graphics/templates`).
   * When set the server renders against exactly this template and derives
   * `kind` from it; omit for the "surprise me" rotation.
   */
  templateSlug: z.string().optional(),
});

export type GenerateGraphicInput = z.infer<typeof generateGraphicInputSchema>;
