import { z } from 'zod';

/**
 * Input for `suggestCampaignService` — pick WHICH service the very first
 * campaign should advertise, plus the "because Y and Z" reasons Claire
 * presents on the campaign_pitch slide.
 */
export const suggestCampaignServiceSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
});

export type SuggestCampaignServiceInput = z.infer<
  typeof suggestCampaignServiceSchema
>;

export interface SuggestCampaignServiceOutput {
  serviceId: string;
  serviceName: string;
  /** Plain-language "because Y and Z" reasons for leading with this service. */
  reasons: string[];
  /** Whether a numeric price could be read off the service row. */
  priceKnown: boolean;
  /** Parsed from the service's freeform `priceText` when `priceKnown`. */
  priceCents?: number;
}
