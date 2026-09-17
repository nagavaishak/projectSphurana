import { z } from 'zod';

export const getStripeConnectionSchema = z.object({
  organizationId: z.string().min(1),
});

export type GetStripeConnectionInput = z.infer<
  typeof getStripeConnectionSchema
>;
