import { refundPaymentRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for refunding a captured payment.
 *
 * DERIVED from the canonical wire contract (`refundPaymentRequestBase` in
 * `@borradh-workspace/contracts`). Only `reason` is client-supplied; the
 * payment id is a route param and `organizationId` is session context, both
 * extended on here. There is deliberately no amount — this refunds in full.
 */
export const refundPaymentSchema = refundPaymentRequestBase.extend({
  paymentId: z.string().min(1),
  organizationId: z.string().min(1),
});

export type RefundPaymentInput = z.infer<typeof refundPaymentSchema>;
