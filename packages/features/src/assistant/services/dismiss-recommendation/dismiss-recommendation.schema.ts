import { z } from 'zod';

export const dismissRecommendationSchema = z.object({
  recommendationId: z.string().min(1),
  organizationId: z.string().min(1),
});

export type DismissRecommendationInput = z.infer<
  typeof dismissRecommendationSchema
>;
