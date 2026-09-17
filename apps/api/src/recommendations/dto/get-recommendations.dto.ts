import { getRecommendationsSchema } from '@borradh-workspace/features/recommendations';
import { createZodDto } from 'nestjs-zod';

// Omit organizationId since it comes from session
export class GetRecommendationsDto extends createZodDto(
  getRecommendationsSchema.omit({ organizationId: true })
) {}
