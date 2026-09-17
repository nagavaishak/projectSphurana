import { z } from 'zod';

export const handleSmsStatusWebhookSchema = z.object({
  /** Twilio message SID — matches campaign_recipient.providerMessageId. */
  messageSid: z.string().optional(),
  /** delivered | undelivered | failed | sent | queued | sending | read */
  messageStatus: z.string().min(1, 'messageStatus is required'),
  /** Twilio error code on undelivered/failed, e.g. 21610 (STOP-filtered). */
  errorCode: z.string().optional(),
  /** Recipient number in E.164 — used to suppress on a STOP-filtered reject. */
  to: z.string().optional(),
});

export type HandleSmsStatusWebhookInput = z.infer<
  typeof handleSmsStatusWebhookSchema
>;
