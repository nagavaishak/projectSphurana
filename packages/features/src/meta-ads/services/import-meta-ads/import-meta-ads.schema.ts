import { z } from 'zod';

export const importMetaAdsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type ImportMetaAdsInput = z.infer<typeof importMetaAdsSchema>;
