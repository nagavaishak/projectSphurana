import { z } from 'zod';

export const ensureCampaignConfigSchema = z.object({
  organizationId: z.string().min(1),
  metaCampaignId: z.string().min(1),
  /** Optional page selection. Falls back to the integration's default page. */
  metaAdsPageId: z.string().optional(),
});

export type EnsureCampaignConfigInput = z.infer<
  typeof ensureCampaignConfigSchema
>;

export const backfillCampaignConfigsSchema = z.object({
  organizationId: z.string().min(1),
  /** Max campaigns to scan from Meta. Defaults to 100. */
  limit: z.number().int().positive().max(500).optional(),
});

export type BackfillCampaignConfigsInput = z.infer<
  typeof backfillCampaignConfigsSchema
>;
