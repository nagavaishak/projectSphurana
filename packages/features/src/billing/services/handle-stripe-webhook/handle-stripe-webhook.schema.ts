import { z } from 'zod';

export const handleStripeWebhookSchema = z.object({
  payload: z.string().min(1, 'Payload is required'),
  signature: z.string().min(1, 'Signature is required'),
});

export type HandleStripeWebhookInput = z.infer<
  typeof handleStripeWebhookSchema
>;
