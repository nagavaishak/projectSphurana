import { z } from 'zod';

export const listDepositsSchema = z.object({
  organizationId: z.string().min(1),
  appointmentId: z.string().min(1).optional(),
  status: z
    .enum(['pending', 'paid', 'expired', 'refunded', 'cancelled'])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListDepositsInput = z.input<typeof listDepositsSchema>;
