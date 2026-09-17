import { z } from 'zod';

export const handleResendWebhookSchema = z.object({
  /** Resend event type, e.g. 'email.delivered', 'email.bounced'. */
  type: z.string().min(1, 'type is required'),
  /** Resend message id — matches campaign_recipient.providerMessageId. */
  emailId: z.string().optional(),
  /** Recipient email address. */
  to: z.string().optional(),
});

export type HandleResendWebhookInput = z.infer<
  typeof handleResendWebhookSchema
>;
