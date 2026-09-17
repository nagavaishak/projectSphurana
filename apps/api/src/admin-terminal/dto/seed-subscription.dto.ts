import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const seedSubscriptionSchema = z.object({
  /** Stripe subscription id (`sub_…`) or customer id (`cus_…`). */
  stripeRef: z
    .string()
    .trim()
    .regex(
      /^(sub|cus)_[A-Za-z0-9]+$/,
      'Enter a Stripe subscription ID (sub_…) or customer ID (cus_…).'
    ),
});

export class SeedSubscriptionDto extends createZodDto(seedSubscriptionSchema) {}
