import { z } from 'zod';

export const getPaymentSchema = z.object({
  paymentId: z.string().min(1),
  organizationId: z.string().min(1),
});

export type GetPaymentInput = z.infer<typeof getPaymentSchema>;
