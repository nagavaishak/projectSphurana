import { z } from 'zod';

export const settleCardPaymentSchema = z.object({
  organizationId: z.string().min(1),
  saleId: z.string().min(1),
  /** The pending manual-card `sale_payment` row to settle. */
  salePaymentId: z.string().min(1),
  createdById: z.string().optional(),
});

export type SettleCardPaymentInput = z.infer<typeof settleCardPaymentSchema>;
