import { z } from 'zod';

export const removeMetaAdsPageSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  pageId: z.string().min(1, 'Page ID is required'), // This is the internal page record ID
});

export type RemoveMetaAdsPageInput = z.infer<typeof removeMetaAdsPageSchema>;
