import { regenerateAdCandidateSchema } from '@borradh-workspace/features/onboarding';
import { createZodDto } from 'nestjs-zod';

/**
 * Body for POST /onboarding/ad-candidates/:graphicId/regenerate — the owner's
 * change request. `userId` comes from the session, `graphicId` from the path.
 */
export class RegenerateAdCandidateDto extends createZodDto(
  regenerateAdCandidateSchema.omit({ userId: true, graphicId: true })
) {}
