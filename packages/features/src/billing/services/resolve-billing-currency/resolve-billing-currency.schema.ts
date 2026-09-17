import { z } from 'zod';

export const resolveBillingCurrencySchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type ResolveBillingCurrencyInput = z.infer<
  typeof resolveBillingCurrencySchema
>;
