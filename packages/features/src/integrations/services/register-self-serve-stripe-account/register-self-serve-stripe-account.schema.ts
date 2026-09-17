import { z } from 'zod';

export const registerSelfServeStripeAccountSchema = z.object({
  /** The single-use authorization code Stripe put on the callback URL. */
  code: z.string().min(1).optional(),
  /** Set by Stripe when the merchant declined on the consent screen. */
  error: z.string().optional(),
});

export type RegisterSelfServeStripeAccountInput = z.input<
  typeof registerSelfServeStripeAccountSchema
>;
