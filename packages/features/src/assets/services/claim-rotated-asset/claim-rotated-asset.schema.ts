import { z } from 'zod';

export const claimRotatedAssetSchema = z.object({
  organizationId: z.string().min(1),
  serviceId: z.string().min(1),
  /** Assets already consumed by an earlier slot on the same template. */
  excludeAssetIds: z.array(z.string().min(1)).default([]),
  /**
   * Whether a video must have a generated thumbnail to qualify. True for
   * graphics (which need a still); false when any clip will do.
   */
  requireThumbnail: z.boolean().default(true),
  /**
   * Restrict the pool to one media type.
   *
   * Graphics take either (a video contributes its thumbnail as a still), so
   * they leave this unset. Video b-roll needs actual footage — a still cannot
   * fill a clip slot — so the planner passes `'video'`.
   */
  mediaType: z.enum(['image', 'video']).optional(),
  /**
   * Whether a video must have finished transcoding to qualify.
   *
   * The b-roll planner passes true so it stays in lock-step with
   * `queueVideoExport`'s render gate. It belongs INSIDE the claim rather than
   * as a filter afterwards: the claim stamps `last_used_at` as it picks, so
   * discarding an untranscoded winner after the fact would burn a rotation
   * slot on an asset that never appeared in a video.
   */
  requireTranscodeReady: z.boolean().default(false),
});

export type ClaimRotatedAssetInput = z.input<typeof claimRotatedAssetSchema>;
