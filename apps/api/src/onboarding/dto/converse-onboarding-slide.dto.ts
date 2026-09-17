import { converseOnboardingSlideSchema } from '@borradh-workspace/features/onboarding';
import { createZodDto } from 'nestjs-zod';

/**
 * Body for POST /onboarding/converse — a free-text Claire round-trip on a
 * conversational slide. `userId` comes from the authenticated session.
 */
export class ConverseOnboardingSlideDto extends createZodDto(
  converseOnboardingSlideSchema.omit({ userId: true })
) {}
