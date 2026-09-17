import { z } from 'zod';

export const markRecommendationActionedSchema = z.object({
  recommendationId: z.string().min(1),
  organizationId: z.string().min(1),
});

export type MarkRecommendationActionedInput = z.infer<
  typeof markRecommendationActionedSchema
>;
