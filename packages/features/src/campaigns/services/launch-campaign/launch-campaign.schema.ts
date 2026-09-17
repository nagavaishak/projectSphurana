import { launchCampaignRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * DERIVED from the wire contract — see `packages/contracts/src/requests/
 * campaigns.ts`. `POST campaigns/:id/launch` takes no body at all, so the whole
 * server input is context: the route param plus the session org.
 */
export const launchCampaignSchema = launchCampaignRequestBase.extend({
  organizationId: z.string().min(1, 'Organization ID is required'),
  id: z.string().min(1, 'Campaign ID is required'),
});

export type LaunchCampaignInput = z.infer<typeof launchCampaignSchema>;
