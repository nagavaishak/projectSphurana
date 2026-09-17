import { z } from 'zod';

export const handleWhatsAppWebhookSchema = z.object({
  payload: z.string().min(1, 'Payload is required'),
  signature: z.string().min(1, 'Signature is required'),
});

export type HandleWhatsAppWebhookInput = z.infer<
  typeof handleWhatsAppWebhookSchema
>;
