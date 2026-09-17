import { startOnboardingWebsiteAnalysisSchema } from '@borradh-workspace/features/onboarding';
import { createZodDto } from 'nestjs-zod';

/**
 * Body for POST /onboarding/website — store the URL and kick the
 * website-analysis job. `userId` comes from the authenticated session.
 */
export class StartOnboardingWebsiteDto extends createZodDto(
  startOnboardingWebsiteAnalysisSchema.omit({ userId: true })
) {}
