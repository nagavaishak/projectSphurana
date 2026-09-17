import { z } from 'zod';

export const disconnectStripeSchema = z.object({
  organizationId: z.string().min(1),
});

export type DisconnectStripeInput = z.infer<typeof disconnectStripeSchema>;
