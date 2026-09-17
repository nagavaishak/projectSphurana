import {
  campaignChannelRequestZ,
  createCampaignRequestBase,
} from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * The campaign channel enum. Historically declared here; it now lives in the
 * request contract (sourced from `@borradh-workspace/labels`) and is re-exported
 * under its original name so existing imports keep working.
 */
export const campaignChannelZ = campaignChannelRequestZ;

/**
 * DERIVED from the wire contract — see `packages/contracts/src/requests/
 * campaigns.ts`. The server schema IS the `POST campaigns` body plus the
 * context the controller injects, so it can never be laxer than the wire.
 */
export const createCampaignSchema = createCampaignRequestBase.extend({
  organizationId: z.string().min(1, 'Organization ID is required'),
  createdById: z.string().optional(),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
