import { z } from 'zod';

/**
 * Auto-provision input — just the org. The template identity is fixed (the
 * canonical `borradh_campaign_message`), so there is nothing else to pass.
 */
export const ensureCampaignWhatsappTemplateSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type EnsureCampaignWhatsappTemplateInput = z.infer<
  typeof ensureCampaignWhatsappTemplateSchema
>;
