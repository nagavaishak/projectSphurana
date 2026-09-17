import { z } from 'zod';

export const recordSuppressionSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  channel: z.enum(['email', 'sms', 'whatsapp']),
  contact: z.string().min(1, 'Contact is required'),
  reason: z.enum(['unsubscribe', 'stop', 'bounce', 'complaint']),
  source: z.string().optional(),
});

export type RecordSuppressionInput = z.infer<typeof recordSuppressionSchema>;
