import { z } from 'zod';

export const getStripeConnectStatusSchema = z.object({
  organizationId: z.string().min(1),
});

export type GetStripeConnectStatusInput = z.input<
  typeof getStripeConnectStatusSchema
>;
