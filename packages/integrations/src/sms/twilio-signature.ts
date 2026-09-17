import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify Twilio's `X-Twilio-Signature` header for an inbound webhook.
 *
 * Implements Twilio's documented request-validation algorithm (the same one
 * `twilio.validateRequest` runs), so we don't need to pull in the Twilio SDK
 * — the rest of this integration is hand-rolled over `fetch` too.
 *
 * Algorithm (form-encoded webhooks, which is what Twilio SMS posts):
 *   1. Start with the exact request URL Twilio was configured to call
 *      (scheme + host + path + query), byte-for-byte.
 *   2. Append every POST parameter, sorted alphabetically by key, as
 *      `key + value` with NO separators.
 *   3. HMAC-SHA1 that string with the Account **auth token** as the key.
 *   4. Base64-encode the digest and constant-time compare to the header.
 *
 * @see https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function validateTwilioSignature(input: {
  /** The Twilio Account auth token (NOT the API key secret used for sends). */
  authToken: string;
  /** Value of the `X-Twilio-Signature` request header. */
  signature: string | undefined;
  /** Exact URL Twilio was configured to POST to (including any query string). */
  url: string;
  /** All POST parameters as received (the fully-parsed form body). */
  params: Record<string, string | undefined>;
}): boolean {
  const { authToken, signature, url, params } = input;
  if (!authToken || !signature) return false;

  // URL first, then each param key+value in alphabetical key order.
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + (params[key] ?? ''), url);

  const expected = createHmac('sha1', authToken).update(data, 'utf8').digest();

  let provided: Buffer;
  try {
    provided = Buffer.from(signature, 'base64');
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
