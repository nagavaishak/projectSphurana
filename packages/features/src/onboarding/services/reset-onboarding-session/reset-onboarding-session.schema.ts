import { z } from 'zod';

export const resetOnboardingSessionSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
});

export type ResetOnboardingSessionInput = z.infer<
  typeof resetOnboardingSessionSchema
>;
