/**
 * The channel-sender abstraction the send primitive dispatches through.
 *
 * Dependency-injected at the worker edge so the feature service stays testable
 * (mock senders) and decoupled from provider SDKs / per-org credential
 * resolution. The worker builds the real implementation (Resend for email,
 * Twilio for SMS, WhatsApp Cloud for whatsapp); tests pass fakes.
 */

export interface SendArgs {
  to: string;
  body: string;
  subject?: string;
  /** One-click unsubscribe URL (email only — drives List-Unsubscribe + footer). */
  unsubscribeUrl?: string;
  /**
   * WhatsApp only — when set, the sender dispatches an approved template
   * (business-initiated, works outside the 24h window) instead of free-form
   * text. `parameters` are the fully-interpolated {{1}}..{{n}} values.
   */
  whatsappTemplate?: {
    name: string;
    languageCode: string;
    parameters: string[];
  };
}

export interface SendOutcome {
  messageId: string;
  success: boolean;
  error?: string;
  /**
   * True when the failure is transient (e.g. a provider rate limit) and the
   * send should be retried rather than recorded as a terminal failure.
   * Senders that don't set this are treated as non-retryable — today only
   * the email sender does (Resend's 10 req/s cap).
   */
  retryable?: boolean;
}

export interface ChannelSenders {
  email(args: SendArgs): Promise<SendOutcome>;
  sms(args: SendArgs): Promise<SendOutcome>;
  whatsapp(args: SendArgs): Promise<SendOutcome>;
}
