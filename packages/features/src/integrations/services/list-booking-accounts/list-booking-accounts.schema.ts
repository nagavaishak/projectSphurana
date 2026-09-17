import { z } from 'zod';

export const listBookingAccountsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  provider: z.enum(['calendly', 'timely', 'phorest', 'fresha']).optional(),
});

export type ListBookingAccountsInput = z.infer<
  typeof listBookingAccountsSchema
>;
