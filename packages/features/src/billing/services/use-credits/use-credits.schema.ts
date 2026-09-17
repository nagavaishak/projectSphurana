import { z } from 'zod';

export const useCreditsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  channel: z.enum(['sms', 'email', 'voice', 'whatsapp']),
  quantity: z.number().positive().default(1), // For voice, this is minutes
  referenceId: z.string().optional(), // e.g., message ID, call ID
  referenceType: z.string().optional(), // e.g., 'sms_message', 'voice_call'
  description: z.string().optional(),
});

export type UseCreditsInput = z.infer<typeof useCreditsSchema>;
