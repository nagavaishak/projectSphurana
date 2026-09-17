import { z } from 'zod';

/**
 * Schema for completing the onboarding session.
 */
export const completeOnboardingSessionSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
});

export type CompleteOnboardingSessionInput = z.infer<
  typeof completeOnboardingSessionSchema
>;
