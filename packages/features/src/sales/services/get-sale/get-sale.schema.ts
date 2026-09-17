import { z } from 'zod';

export const getSaleSchema = z.object({
  organizationId: z.string().min(1),
  saleId: z.string().min(1),
});

export type GetSaleInput = z.input<typeof getSaleSchema>;
