import { z } from 'zod';

export const getShopOrderStatusSchema = z.object({
  organizationId: z.string().min(1),
  accessToken: z.string().min(20),
});

export type GetShopOrderStatusInput = z.infer<typeof getShopOrderStatusSchema>;
