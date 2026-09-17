import { z } from 'zod';

export const handleSmsWebhookSchema = z.object({
  /** The org's Twilio number that received the inbound SMS (Twilio `To`). */
  to: z.string().min(1, 'to is required'),
  /** The sender's phone — the lead (Twilio `From`). */
  from: z.string().min(1, 'from is required'),
  /** The message text (Twilio `Body`). */
  body: z.string().default(''),
});

export type HandleSmsWebhookInput = z.infer<typeof handleSmsWebhookSchema>;
