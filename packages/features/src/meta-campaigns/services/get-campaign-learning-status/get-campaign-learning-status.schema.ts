import { z } from 'zod';

/**
 * Schema for the `getCampaignLearningStatus` lookup. Used by Claire's
 * `noLiveCampaignChangeDuringLearningPhase` and `noScalingBeforeLearningExits`
 * hard-block validators (W-C05) and reusable for any UI that needs to know
 * whether a campaign is still inside Meta's learning phase.
 */
export const getCampaignLearningStatusSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  metaCampaignId: z.string().min(1, 'Meta campaign ID is required'),
});

export type GetCampaignLearningStatusInput = z.infer<
  typeof getCampaignLearningStatusSchema
>;
