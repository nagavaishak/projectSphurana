import { z } from 'zod';

/**
 * Schema for the `getCampaignCurrency` lookup. Reads the ad-account currency
 * snapshot stored on `meta_campaign_config` at campaign-creation time. Used by
 * the ad tools to derive the budget display string SERVER-SIDE (never from
 * model-authored free text — register #82).
 */
export const getCampaignCurrencySchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  metaCampaignId: z.string().min(1, 'Meta campaign ID is required'),
});

export type GetCampaignCurrencyInput = z.infer<
  typeof getCampaignCurrencySchema
>;
