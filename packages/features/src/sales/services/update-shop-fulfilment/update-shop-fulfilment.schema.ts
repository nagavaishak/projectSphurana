import { z } from 'zod';

export const updateShopFulfilmentSchema = z.object({
  organizationId: z.string().min(1),
  saleId: z.string().min(1),
  userId: z.string().min(1),
  status: z.enum(['ready', 'collected']),
});

export type UpdateShopFulfilmentInput = z.infer<
  typeof updateShopFulfilmentSchema
>;
