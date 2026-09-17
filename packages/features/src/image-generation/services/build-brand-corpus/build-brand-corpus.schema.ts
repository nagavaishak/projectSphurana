import { z } from 'zod';

/**
 * Schema for building / refreshing an org's brand corpus.
 *
 * Heavy background job: pulls the org's published media, vision-describes +
 * embeds each NEW item (deduped by postId), and upserts into
 * `brand_media_embedding`. Re-runs are incremental.
 */
export const buildBrandCorpusSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  /** Max items to pull per platform. */
  limit: z.number().int().min(1).max(1000).default(300),
  /**
   * Concurrency for the per-item vision-describe + embed. Kept low (default
   * 4) so describing hundreds of items doesn't trip Anthropic rate limits;
   * the SDK adds 429 backoff on top.
   */
  concurrency: z.number().int().min(1).max(16).default(4),
});

/**
 * `z.input`, not `z.infer`. This type names what a CALLER may pass, and both
 * `limit` and `concurrency` carry defaults — `z.infer` is the parsed OUTPUT,
 * where the default has already been applied and the field is required. Typing
 * the parameter with it forces every caller to restate the defaults, which is
 * the one thing a default exists to avoid. The body reads `parsed.data`, which
 * is still the fully-populated output.
 */
export type BuildBrandCorpusInput = z.input<typeof buildBrandCorpusSchema>;
