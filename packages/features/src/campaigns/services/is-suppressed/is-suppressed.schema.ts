import { z } from 'zod';

export const isSuppressedSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  channel: z.enum(['email', 'sms', 'whatsapp']),
  contact: z.string().min(1, 'Contact is required'),
});

export type IsSuppressedInput = z.infer<typeof isSuppressedSchema>;
