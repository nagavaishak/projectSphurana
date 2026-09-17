import { z } from 'zod';

export const listServiceStockClipsSchema = z.object({
  organizationId: z.string().min(1),
  serviceId: z.string().min(1).optional().nullable(),
  mediaType: z.enum(['video', 'image']).optional(),
  limit: z.number().int().positive().max(60).default(24),
});

export type ListServiceStockClipsInput = z.input<
  typeof listServiceStockClipsSchema
>;
