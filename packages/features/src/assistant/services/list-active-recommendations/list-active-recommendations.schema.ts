import { z } from 'zod';

export const listActiveRecommendationsSchema = z.object({
  organizationId: z.string().min(1),
});

export type ListActiveRecommendationsInput = z.infer<
  typeof listActiveRecommendationsSchema
>;
