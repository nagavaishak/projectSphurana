import { z } from 'zod';

export const disconnectBookingAccountSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  accountId: z.string().min(1, 'Account ID is required'),
});

export type DisconnectBookingAccountInput = z.infer<
  typeof disconnectBookingAccountSchema
>;
