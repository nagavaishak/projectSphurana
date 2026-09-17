import { z } from 'zod';

export const getRecommendationsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  /** Number of days to analyze (default: 7) */
  days: z.coerce.number().int().min(1).max(30).default(7),
  /** Maximum recommendations to return (default: 10) */
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export type GetRecommendationsInput = z.infer<typeof getRecommendationsSchema>;
