import { externalRedirectUrl } from '@borradh-workspace/contracts';
import { z } from 'zod';

export const supportedCurrencies = ['usd', 'eur', 'gbp'] as const;
export type SupportedCurrency = (typeof supportedCurrencies)[number];

export const createSubscriptionCheckoutSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  customerEmail: z.string().email('Valid email is required'),
  successUrl: externalRedirectUrl,
  cancelUrl: externalRedirectUrl,
  trialDays: z.number().int().positive().optional(),
  currency: z.enum(supportedCurrencies).default('usd').optional(),
});

export type CreateSubscriptionCheckoutInput = z.infer<
  typeof createSubscriptionCheckoutSchema
>;
