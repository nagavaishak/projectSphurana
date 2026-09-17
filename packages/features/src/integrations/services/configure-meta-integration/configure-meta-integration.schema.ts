import { z } from 'zod';

/**
 * Schema for configuring a pending Meta Ads integration (wizard completion)
 * Supports multi-select: arrays of ad account IDs and page IDs
 */
export const configureMetaIntegrationSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  integrationId: z.string().min(1, 'Integration ID is required'),
  // Wizard selections (multi-select)
  adAccountIds: z
    .array(z.string().min(1))
    .min(1, 'At least one ad account is required'),
  pageIds: z.array(z.string().min(1)).min(1, 'At least one page is required'),
});

export type ConfigureMetaIntegrationInput = z.infer<
  typeof configureMetaIntegrationSchema
>;
