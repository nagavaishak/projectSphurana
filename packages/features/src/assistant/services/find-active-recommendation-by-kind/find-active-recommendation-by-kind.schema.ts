import { assistantRecommendationKindValues } from '@borradh-workspace/database';
import { z } from 'zod';

export const findActiveRecommendationByKindSchema = z.object({
  organizationId: z.string().min(1),
  kind: z.enum(assistantRecommendationKindValues),
});

export type FindActiveRecommendationByKindInput = z.infer<
  typeof findActiveRecommendationByKindSchema
>;
