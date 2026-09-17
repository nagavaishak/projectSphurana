import { z } from 'zod';

export const handlePaymentWebhookSchema = z.object({
  eventType: z.enum([
    'checkout.session.completed',
    'checkout.session.expired',
    'charge.refunded',
  ]),
  checkoutSessionId: z.string().optional(),
  paymentIntentId: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

export type HandlePaymentWebhookInput = z.infer<
  typeof handlePaymentWebhookSchema
>;
