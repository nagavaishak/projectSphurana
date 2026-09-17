import { z } from 'zod';

export const listAssetsByServiceSchema = z.object({
  serviceId: z.string().min(1, 'Service ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  type: z.enum(['video', 'image']).default('video'),
});

export type ListAssetsByServiceInput = z.input<
  typeof listAssetsByServiceSchema
>;
