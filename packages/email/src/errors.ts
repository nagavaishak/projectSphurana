/**
 * Thrown by `sendEmail`/`sendHtmlEmail` when Resend rejects a send. Carries
 * Resend's own error `name` (e.g. `rate_limit_exceeded`) as `code`, so
 * callers can tell a transient, retryable rejection apart from a permanent
 * one (bad address, invalid domain, etc.) without string-matching the
 * message.
 */
export class ResendSendError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'ResendSendError';
    this.code = code;
  }
}
