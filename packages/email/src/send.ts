import { render } from '@react-email/render';
import type { ComponentType } from 'react';
import { createElement } from 'react';
import { getDefaultFrom, sendResendEmail } from './client.js';
import { ResendSendError } from './errors.js';
import { isUndeliverableEmail } from './undeliverable-email.js';

export interface SendEmailOptions<TProps extends Record<string, unknown>> {
  to: string | string[];
  subject: string;
  template: ComponentType<TProps>;
  props: TProps;
  from?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
}

export interface SendEmailResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
}

export async function sendEmail<TProps extends Record<string, unknown>>(
  options: SendEmailOptions<TProps>
): Promise<SendEmailResult> {
  const { to, subject, template, props, from, replyTo, cc, bcc } = options;

  // Reserved domains (RFC 2606 / 6761) cannot receive mail, and Resend rejects
  // them outright: "Invalid `to` field. Please use our testing email address
  // instead of domains like example.com". Our E2E suite provisions every user
  // at @example.com, so this threw on every seeded appointment, invitation,
  // team-member and public-booking cancel — ~1k Sentry events reporting a send
  // that was never possible.
  //
  // Not suppression: there is no delivery to attempt. A bad address at a REAL
  // domain still goes to Resend and still errors.
  const recipients = Array.isArray(to) ? to : [to];
  const deliverable = recipients.filter((r) => !isUndeliverableEmail(r));
  if (deliverable.length === 0) {
    return {
      messageId: 'skipped-undeliverable',
      accepted: [],
      rejected: recipients,
    };
  }

  // Render the template ourselves with `@react-email/render` (a direct dep of
  // this package) and send `html`/`text`, rather than passing `react:` and
  // relying on resend to resolve `@react-email/render` from its own location —
  // which fails under pnpm's strict node_modules isolation ("Failed to render
  // React component. Make sure to install `@react-email/render`").
  const element = createElement(template, props);
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);

  const { data, error } = await sendResendEmail({
    from: from ?? getDefaultFrom(),
    to: deliverable,
    cc: cc ? (Array.isArray(cc) ? cc : [cc]) : undefined,
    bcc: bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : undefined,
    replyTo: replyTo,
    subject,
    html,
    text,
  });

  if (error) {
    throw new ResendSendError(
      `Failed to send email: ${error.message}`,
      error.name
    );
  }

  return {
    messageId: data?.id ?? '',
    // Anything filtered out above was never sent, so report it as rejected
    // rather than silently claiming it was accepted.
    accepted: deliverable,
    rejected: recipients.filter((r) => !deliverable.includes(r)),
  };
}
