import { z } from 'zod';

/**
 * The webhook entry point hands us the RAW request body, not a parsed object:
 * Meta's `x-hub-signature-256` is an HMAC over the exact bytes, so any
 * re-serialisation would invalidate it. `payload` is therefore a string (and
 * optional, because an empty body is a case this use case must answer for).
 */
export const handleFacebookLeadWebhookSchema = z.object({
  payload: z.string().optional(),
  signature: z.string().optional(),
});

export type HandleFacebookLeadWebhookInput = z.infer<
  typeof handleFacebookLeadWebhookSchema
>;
