import { z } from 'zod';

export const seedSubscriptionSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  /**
   * A Stripe subscription id (`sub_…`) or customer id (`cus_…`).
   *
   * Both are accepted because an operator reading the Stripe dashboard has
   * whichever one is in front of them, and resolving a customer to their
   * subscription is a single API call — cheaper than a mis-paste caused by
   * making them go and find the other id.
   */
  stripeRef: z
    .string()
    .trim()
    .regex(
      /^(sub|cus)_[A-Za-z0-9]+$/,
      'Enter a Stripe subscription ID (sub_…) or customer ID (cus_…).'
    ),
});

export type SeedSubscriptionInput = z.input<typeof seedSubscriptionSchema>;
