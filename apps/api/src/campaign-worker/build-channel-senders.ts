import { ResendSendError, sendHtmlEmail } from '@borradh-workspace/email';
import { apiEnv } from '@borradh-workspace/env/api';
import type {
  ChannelSenders,
  ResolvedSmsSender,
  SendOutcome,
} from '@borradh-workspace/features/campaigns';
import { renderCampaignEmailHtml } from '@borradh-workspace/features/campaigns/content';
import { WhatsAppCloudService } from '@borradh-workspace/integrations';
import { TwilioSMSService } from '@borradh-workspace/integrations/sms';

/**
 * Build the real channel senders the campaign worker dispatches through.
 *
 * - email → Resend from the org's `<slug>@campaign.borradh.io` address (sendHtmlEmail)
 * - sms   → Twilio from the org's provisioned local number
 * - whatsapp → WhatsApp Cloud API via the org's linked business account:
 *   approved template (business-initiated) when the message has one, else
 *   free-form text (24h customer-service window)
 *
 * The org's SMS from-number is resolved by the worker (inside system scope) and
 * passed in, so this stays a pure factory.
 */
/**
 * Where Twilio posts delivery-state transitions. Returns undefined when the API
 * has no public URL configured — the send still goes out, it just stays at
 * `sent` rather than resolving to delivered/failed.
 */
function smsStatusCallbackUrl(): string | undefined {
  const base = apiEnv.API_URL;
  return base ? `${base.replace(/\/$/, '')}/webhooks/twilio/status` : undefined;
}

export function buildChannelSenders(opts: {
  /**
   * How this org sends SMS: `alpha` (branded sender ID, one-way — opt-out link
   * is mandatory) or `number` (dedicated number, two-way). Resolved by the
   * worker; absent ⇒ SMS sends fail with a clear reason.
   */
  smsSender?: ResolvedSmsSender;
  twilio?: TwilioSMSService;
  /** Business display name shown as the email sender (the org's name). */
  fromName?: string;
  /** The email From address — the org's `<slug>@campaign.borradh.io`. */
  fromAddress?: string;
  /** Org's decrypted WhatsApp Cloud credentials (resolved by the worker). */
  whatsapp?: { accessToken: string; phoneNumberId: string };
}): ChannelSenders {
  return {
    email: async ({
      to,
      subject,
      body,
      unsubscribeUrl,
    }): Promise<SendOutcome> => {
      try {
        const headers = unsubscribeUrl
          ? {
              'List-Unsubscribe': `<${unsubscribeUrl}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            }
          : undefined;
        // The ONE converter the preview also uses — the unsubscribe footer is
        // appended here (opt-out hard gate) whenever an unsubscribe URL exists.
        const html = renderCampaignEmailHtml(body, { unsubscribeUrl });
        const res = await sendHtmlEmail({
          to,
          subject: subject ?? '',
          html,
          headers,
          fromName: opts.fromName,
          fromAddress: opts.fromAddress,
        });
        return { messageId: res.messageId, success: true };
      } catch (error) {
        // Rate-limit rejections, the client-side limiter timing out, and
        // Resend's own 5xx processing failures are transient — not a bad
        // recipient — so the worker should retry rather than permanently fail
        // this recipient. `sendResendEmail` has already retried provider 5xxs
        // idempotently before they reach this fallback.
        const retryable =
          error instanceof ResendSendError &&
          (error.code === 'rate_limit_exceeded' ||
            error.code === 'client_rate_limit_timeout' ||
            error.code === 'application_error' ||
            error.code === 'internal_server_error');
        return {
          messageId: '',
          success: false,
          error: error instanceof Error ? error.message : 'email send failed',
          retryable,
        };
      }
    },

    sms: async ({ to, body, unsubscribeUrl }): Promise<SendOutcome> => {
      const sender = opts.smsSender;
      if (!sender || sender.mode === 'none') {
        return {
          messageId: '',
          success: false,
          error:
            sender?.mode === 'none'
              ? sender.reason
              : 'No SMS sender configured',
        };
      }
      // Construct lazily: the Twilio client throws when credentials are
      // missing, and that must fail only SMS recipients — not take down
      // email/WhatsApp sends on environments without Twilio configured.
      let twilio: TwilioSMSService;
      try {
        twilio = opts.twilio ?? new TwilioSMSService();
      } catch (error) {
        return {
          messageId: '',
          success: false,
          error:
            error instanceof Error ? error.message : 'SMS is not configured',
        };
      }

      // Alphanumeric senders are one-way: recipients cannot text STOP back, so
      // an opt-out link in the body is the ONLY opt-out affordance and is
      // mandatory. Refuse rather than send a non-compliant message.
      if (sender.mode === 'alpha' && !unsubscribeUrl) {
        return {
          messageId: '',
          success: false,
          error: 'Refusing to send a one-way alpha SMS with no opt-out link',
        };
      }

      const from =
        sender.mode === 'alpha' ? sender.senderId : sender.phoneNumber;
      // Append the opt-out link (always for alpha; also for numbers when present
      // — good practice on top of their two-way STOP handling).
      const finalBody = unsubscribeUrl
        ? `${body}\nOpt out: ${unsubscribeUrl}`
        : body;

      const r = await twilio.sendSMS({
        to,
        body: finalBody,
        from,
        statusCallbackUrl: smsStatusCallbackUrl(),
      });
      return { messageId: r.messageId, success: r.success, error: r.error };
    },

    whatsapp: async ({ to, body, whatsappTemplate }): Promise<SendOutcome> => {
      if (!opts.whatsapp) {
        return {
          messageId: '',
          success: false,
          error: 'No active WhatsApp account connected for this organization',
        };
      }
      try {
        const wa = new WhatsAppCloudService(
          opts.whatsapp.accessToken,
          opts.whatsapp.phoneNumberId
        );
        if (whatsappTemplate) {
          const r = await wa.sendTemplateMessage({
            to,
            templateName: whatsappTemplate.name,
            languageCode: whatsappTemplate.languageCode,
            // Positional {{1}}..{{n}} params as an integer-keyed record (the
            // client serializes Object.values in key order).
            parameters: Object.fromEntries(
              whatsappTemplate.parameters.map((value, i) => [String(i), value])
            ),
          });
          return { messageId: r.messageId, success: r.success };
        }
        // Free-form text (delivers within WhatsApp's 24h customer-service
        // window); business-initiated sends outside it require a template.
        const r = await wa.sendTextMessage(to, body);
        return { messageId: r.messageId, success: r.success };
      } catch (error) {
        return {
          messageId: '',
          success: false,
          error:
            error instanceof Error ? error.message : 'whatsapp send failed',
        };
      }
    },
  };
}
