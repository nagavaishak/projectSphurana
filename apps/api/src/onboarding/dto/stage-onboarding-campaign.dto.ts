import { stageOnboardingCampaignSchema } from '@borradh-workspace/features/onboarding';
import { createZodDto } from 'nestjs-zod';

/**
 * Body for POST /onboarding/stage-campaign — optional owner-picked daily
 * budget override. `userId` comes from the authenticated session.
 */
export class StageOnboardingCampaignDto extends createZodDto(
  stageOnboardingCampaignSchema.omit({ userId: true })
) {}
