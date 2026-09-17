import { z } from 'zod';

/**
 * Schema for launching the staged onboarding campaign (post-FLfB-connect).
 */
export const launchStagedCampaignSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
});

export type LaunchStagedCampaignInput = z.infer<
  typeof launchStagedCampaignSchema
>;

/** Which orchestrator step failed — carried in the error details so the
 *  frontend can show a step-specific message and offer a resume-retry. */
export type LaunchStagedCampaignStep =
  | 'create_campaign'
  | 'sync_lead_form'
  | 'create_ads'
  | 'launch_ads';
