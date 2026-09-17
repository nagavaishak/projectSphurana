import { z } from 'zod';

export const refreshStripeAccountSchema = z.object({
  organizationId: z.string().min(1),
});

export type RefreshStripeAccountInput = z.infer<
  typeof refreshStripeAccountSchema
>;
