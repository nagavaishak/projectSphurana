/**
 * Best-effort PII redaction for log payloads.
 *
 * Strips emails, long digit runs that look like phone numbers, and
 * access_token query parameters. Names are intentionally left in place —
 * customer DMs need them for diagnostic context and name detection is
 * unreliable without a NER model.
 *
 * Use for ANY raw payload fragment that gets attached to a log line
 * (message previews, AI raw responses, webhook bodies, etc.).
 */

const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gi;

// 8+ chars of digits possibly mixed with spaces, dashes, parens, dots, leading +
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/g;

// access_token=… in URLs or query strings
const URL_ACCESS_TOKEN = /access_token=[^&\s"']+/gi;

// Bearer tokens (common in headers leaking into bodies)
const BEARER = /Bearer\s+[A-Za-z0-9._-]+/g;

export function redactPII(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .replace(EMAIL, '[EMAIL]')
    .replace(URL_ACCESS_TOKEN, 'access_token=[REDACTED]')
    .replace(BEARER, 'Bearer [REDACTED]')
    .replace(PHONE, '[PHONE]');
}
