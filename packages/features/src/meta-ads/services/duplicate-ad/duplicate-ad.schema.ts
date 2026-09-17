import { z } from 'zod';

export const duplicateAdSchema = z.object({
  /** Local ad id (metaAd.id) to duplicate. */
  adId: z.string().min(1, 'Ad ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type DuplicateAdInput = z.infer<typeof duplicateAdSchema>;
