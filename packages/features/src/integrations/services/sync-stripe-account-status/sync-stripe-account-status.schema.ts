import { z } from 'zod';

export const syncStripeAccountStatusSchema = z.object({
  stripeAccountId: z.string().min(1, 'Stripe account ID is required'),
  chargesEnabled: z.boolean(),
  payoutsEnabled: z.boolean(),
  detailsSubmitted: z.boolean(),
  email: z.string().email().nullable().optional(),
  businessName: z.string().nullable().optional(),
  defaultCurrency: z.string().nullable().optional(),
  // Mirrors of account.requirements (embedded Connect onboarding)
  requirementsCurrentlyDue: z.array(z.string()).nullable().optional(),
  disabledReason: z.string().nullable().optional(),
});

export type SyncStripeAccountStatusInput = z.infer<
  typeof syncStripeAccountStatusSchema
>;
