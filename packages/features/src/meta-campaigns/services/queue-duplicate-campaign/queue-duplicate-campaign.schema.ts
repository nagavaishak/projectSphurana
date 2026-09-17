import { z } from 'zod';

/**
 * BullMQ queue name for backgrounded campaign duplication. Must match the
 * consumer constant in `apps/video-worker/src/meta-campaign-duplicate-processor.ts`.
 */
export const META_CAMPAIGN_DUPLICATE_QUEUE = 'meta-campaign-duplicate';

export const queueDuplicateCampaignSchema = z.object({
  organizationId: z.string().min(1),
  metaCampaignId: z.string().min(1),
  /** Acting user, for observability only. */
  userId: z.string().optional(),
});

export type QueueDuplicateCampaignInput = z.infer<
  typeof queueDuplicateCampaignSchema
>;

/** Payload carried on the BullMQ job. */
export type DuplicateCampaignJobPayload = QueueDuplicateCampaignInput;
