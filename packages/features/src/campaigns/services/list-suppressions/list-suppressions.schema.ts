import { z } from 'zod';

export const listSuppressionsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  channel: z.enum(['email', 'sms', 'whatsapp']).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export type ListSuppressionsInput = z.infer<typeof listSuppressionsSchema>;
