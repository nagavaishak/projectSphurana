import { z } from 'zod';

export const getSubscriptionSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GetSubscriptionInput = z.infer<typeof getSubscriptionSchema>;
