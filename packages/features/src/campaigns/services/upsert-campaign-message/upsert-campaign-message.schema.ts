import { upsertCampaignMessageRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for upserting a campaign's per-channel message.
 *
 * DERIVED from the canonical wire contract
 * (`upsertCampaignMessageRequestBase` in `@borradh-workspace/contracts`) by
 * extending the server-injected context fields onto it. Field rules — the
 * channel enum, `body.min(1)`, the `.max(20)` WhatsApp param ceiling,
 * `mediaUrl.url()` — live in the contract; do not restate them here.
 */
export const upsertCampaignMessageSchema =
  upsertCampaignMessageRequestBase.extend({
    organizationId: z.string().min(1, 'Organization ID is required'),
    campaignId: z.string().min(1, 'Campaign ID is required'),
  });

export type UpsertCampaignMessageInput = z.infer<
  typeof upsertCampaignMessageSchema
>;
