import { z } from 'zod';

/**
 * Schema for pulling an org's own published social media (Facebook Page
 * posts + Instagram media). Feeds the per-org "brand corpus" backing AI
 * branded-graphic generation.
 */
export const fetchPageMediaSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  /**
   * Max items to return PER platform. The corpus build pulls hundreds; the
   * cap defends against runaway pagination on very active pages.
   */
  limit: z.number().int().min(1).max(1000).default(300),
});

export type FetchPageMediaInput = z.infer<typeof fetchPageMediaSchema>;
