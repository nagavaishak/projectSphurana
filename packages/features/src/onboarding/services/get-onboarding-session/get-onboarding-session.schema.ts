import { z } from 'zod';

export const getOnboardingSessionSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  /**
   * When false, absent sessions return null instead of being created.
   * Login-landing peeks with false so legacy users (who predate the flow)
   * never get a session row minted just by signing in.
   */
  createIfMissing: z.boolean().default(true),
});

export type GetOnboardingSessionInput = z.infer<
  typeof getOnboardingSessionSchema
>;
