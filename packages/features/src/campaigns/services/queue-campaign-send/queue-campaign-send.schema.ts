import { z } from 'zod';

export const CAMPAIGN_SEND_QUEUE = 'campaign-send';
export const CAMPAIGN_SEND_DLQ = 'campaign-send-dlq';

export const enqueueCampaignSendSchema = z.object({
  recipientId: z.string().min(1, 'Recipient ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  campaignId: z.string().min(1, 'Campaign ID is required'),
  /** Delay (ms) — used for scheduled sends and quiet-hours/throttle re-delays. */
  delayMs: z.coerce.number().int().nonnegative().default(0),
});

export type EnqueueCampaignSendInput = z.infer<
  typeof enqueueCampaignSendSchema
>;

export interface CampaignSendJobPayload {
  recipientId: string;
  organizationId: string;
  campaignId: string;
}
