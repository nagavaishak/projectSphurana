import { z } from 'zod';

export const voidSaleSchema = z.object({
  organizationId: z.string().min(1),
  saleId: z.string().min(1),
});

export type VoidSaleInput = z.input<typeof voidSaleSchema>;
