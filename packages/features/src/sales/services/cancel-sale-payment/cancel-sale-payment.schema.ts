import { z } from 'zod';

export const cancelSalePaymentSchema = z.object({
  organizationId: z.string().min(1),
  saleId: z.string().min(1),
  /** The pending Stripe `sale_payment` row to abandon. */
  salePaymentId: z.string().min(1),
});

export type CancelSalePaymentInput = z.infer<typeof cancelSalePaymentSchema>;
