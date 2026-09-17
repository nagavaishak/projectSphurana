import { z } from 'zod';

/**
 * Schema for staging the onboarding campaign locally (BEFORE Meta connect).
 */
export const stageOnboardingCampaignSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  /** Optional owner-picked budget; defaults to the org's ad budget default. */
  dailyBudgetCents: z.number().int().positive().optional(),
});

export type StageOnboardingCampaignInput = z.infer<
  typeof stageOnboardingCampaignSchema
>;
