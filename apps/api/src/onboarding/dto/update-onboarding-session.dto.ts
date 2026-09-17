import { updateOnboardingSessionSchema } from '@borradh-workspace/features/onboarding';
import { createZodDto } from 'nestjs-zod';

/**
 * Body for PATCH /onboarding/session — advance the slide pointer and/or
 * record a slide answer. `userId` comes from the authenticated session.
 */
export class UpdateOnboardingSessionDto extends createZodDto(
  updateOnboardingSessionSchema.omit({ userId: true })
) {}
