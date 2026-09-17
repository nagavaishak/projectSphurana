import { emailEnv } from '@borradh-workspace/env/email';
import { sendResendEmail } from './client.js';
import { ResendSendError } from './errors.js';

export interface SendHtmlEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  /** Display name shown as the sender, e.g. "John from Acme Co" */
  fromName?: string;
  replyTo?: string;
  /** Override the From address (e.g. the campaign.borradh.io subdomain). */
  fromAddress?: string;
  /** Extra SMTP headers, e.g. List-Unsubscribe / List-Unsubscribe-Post. */
  headers?: Record<string, string>;
}

export interface SendHtmlEmailResult {
  messageId: string;
}

/**
 * Send a raw HTML email via Resend using the dedicated send. subdomain.
 *
 * Used by the sequence executor when the user chose "Use Borradh Email"
 * instead of connecting their own Gmail/Outlook account.
 */
export async function sendHtmlEmail(
  options: SendHtmlEmailOptions
): Promise<SendHtmlEmailResult> {
  const { to, subject, html, fromName, replyTo, fromAddress, headers } =
    options;

  const displayName = fromName || emailEnv.EMAIL_FROM_NAME;
  const from = `${displayName} <${fromAddress || emailEnv.SEQUENCE_FROM_ADDRESS}>`;

  const { data, error } = await sendResendEmail({
    from,
    to: Array.isArray(to) ? to : [to],
    replyTo,
    subject,
    html,
    headers,
  });

  if (error) {
    throw new ResendSendError(
      `Failed to send HTML email: ${error.message}`,
      error.name
    );
  }

  return { messageId: data?.id ?? '' };
}
