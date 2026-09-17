import { z } from 'zod';

export const handleSalePaymentWebhookSchema = z.object({
  eventType: z.enum([
    // QR self-checkout (Payment Link → Checkout Session)
    'checkout.session.completed',
    'checkout.session.expired',
    'charge.refunded',
    // Card-terminal / Tap to Pay (PaymentIntent settled by the reader)
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
  ]),
  paymentIntentId: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  /**
   * charge.refunded only: the charge's cumulative refunded amount and its
   * captured amount, so we can distinguish a full refund from a partial one.
   */
  amountRefundedCents: z.number().int().nonnegative().optional(),
  amountCapturedCents: z.number().int().nonnegative().optional(),
});

export type HandleSalePaymentWebhookInput = z.input<
  typeof handleSalePaymentWebhookSchema
>;
