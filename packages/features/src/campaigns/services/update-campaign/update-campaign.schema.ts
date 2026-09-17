import { updateCampaignRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * DERIVED from the wire contract — see `packages/contracts/src/requests/
 * campaigns.ts`. Adds the route param (`id`) and the session org.
 */
export const updateCampaignSchema = updateCampaignRequestBase.extend({
  organizationId: z.string().min(1, 'Organization ID is required'),
  id: z.string().min(1, 'Campaign ID is required'),
});

export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
