import { z } from 'zod';

export const handleInboundSmsSchema = z.object({
  /** Sender's number, E.164 from Twilio. */
  from: z.string().min(1, 'From is required'),
  /** The number that received the message — the routing key. */
  to: z.string().min(1, 'To is required'),
  body: z.string(),
  /** Twilio `MessageSid`, used to dedupe if the webhook is redelivered. */
  messageId: z.string().optional(),
});

export type HandleInboundSmsInput = z.infer<typeof handleInboundSmsSchema>;
