import { z } from 'zod';

export const completeSaleSchema = z.object({
  organizationId: z.string().min(1),
  saleId: z.string().min(1),
  createdById: z.string().min(1).optional(),
});

export type CompleteSaleInput = z.input<typeof completeSaleSchema>;
