import { z } from 'zod';

export const handleVoiceWebhookSchema = z.object({
  payload: z.string().min(1, 'Payload is required'),
  signature: z.string().min(1, 'Signature is required'),
  timestamp: z.string().min(1, 'Timestamp is required'),
});

export type HandleVoiceWebhookInput = z.infer<typeof handleVoiceWebhookSchema>;
