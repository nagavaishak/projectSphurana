import { z } from 'zod';

export const removeSaleItemSchema = z.object({
  organizationId: z.string().min(1),
  saleId: z.string().min(1),
  itemId: z.string().min(1),
});

export type RemoveSaleItemInput = z.input<typeof removeSaleItemSchema>;
