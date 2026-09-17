import { z } from 'zod';

export const cancelSubscriptionSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  immediate: z.boolean().default(false),
});

export type CancelSubscriptionInput = z.infer<typeof cancelSubscriptionSchema>;
