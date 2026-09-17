import { z } from 'zod';

export const finalizeShopCheckoutSchema = z.object({
  organizationId: z.string().min(1),
  cartId: z.string().min(16),
  checkoutSessionId: z.string().min(1),
  paymentIntentId: z.string().optional(),
  customerEmail: z.string().email().optional(),
  currency: z.string().min(3).max(3),
});

export type FinalizeShopCheckoutInput = z.infer<
  typeof finalizeShopCheckoutSchema
>;
