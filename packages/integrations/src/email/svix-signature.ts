import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify a Svix-format webhook signature (Resend uses Svix under the hood).
 *
 * Implements Svix's documented symmetric-signature scheme without pulling in
 * the `svix` SDK:
 *   1. signed content = `${svix-id}.${svix-timestamp}.${rawBody}`
 *   2. HMAC-SHA256 with the secret (base64, after stripping the `whsec_`
 *      prefix) as the key.
 *   3. Base64-encode the digest.
 *   4. The `svix-signature` header is a space-separated list of
 *      `version,signature` pairs (e.g. `v1,<sig> v1,<sig2>`); accept if ANY
 *      `v1` entry matches, using a constant-time compare.
 *   5. `svix-timestamp` is within `toleranceSeconds` of now, in BOTH
 *      directions.
 *
 * Step 5 is the replay window, and it is not optional. HMAC proves a payload
 * was signed by the secret holder; it says nothing about WHEN. With no clock
 * comparison a captured `(svix-id, svix-timestamp, svix-signature, rawBody)`
 * tuple stays valid forever, so anyone who ever observes one delivery — a
 * proxy log, an errored body in an APM trace, a pasted curl — can replay it
 * indefinitely. `svix-timestamp` is already signed input, so an attacker
 * cannot move the window; the only thing missing was reading it.
 *
 * The future side matters too: accepting far-future timestamps would let one
 * capture be minted with an expiry years out, which is the same defect wearing
 * a different sign.
 *
 * This does NOT make delivery idempotent. There is still no `svix-id` nonce
 * store, so a replay INSIDE the window is accepted. Narrowing forever to five
 * minutes is the large win; de-duplication is a separate change with a storage
 * cost, and is deliberately not bundled here.
 *
 * @see https://docs.svix.com/receiving/verifying-payloads/how-manual
 */

/** Svix's documented tolerance: five minutes, each way. */
export const SVIX_DEFAULT_TOLERANCE_SECONDS = 300;

export function verifySvixSignature(input: {
  /** Signing secret, with or without the `whsec_` prefix. */
  secret: string;
  /** `svix-id` header. */
  id: string | undefined;
  /** `svix-timestamp` header (unix SECONDS, as Svix sends it). */
  timestamp: string | undefined;
  /** `svix-signature` header (space-separated `version,sig` list). */
  signature: string | undefined;
  /** The RAW request body, exactly as received (not re-serialized). */
  payload: string;
  /** Replay window, each way. Defaults to Svix's documented 300s. */
  toleranceSeconds?: number;
  /** Injectable clock (unix MILLISECONDS) so tests need not mock global time. */
  nowMs?: number;
}): boolean {
  const {
    secret,
    id,
    timestamp,
    signature,
    payload,
    toleranceSeconds = SVIX_DEFAULT_TOLERANCE_SECONDS,
    nowMs = Date.now(),
  } = input;
  if (!secret || !id || !timestamp || !signature) return false;

  // Replay window. Checked BEFORE the HMAC: a stale delivery is rejected on
  // the same grounds whatever it is signed with, and there is no secret-
  // dependent work to time. `Number()` on a non-numeric header yields NaN, and
  // every comparison against NaN is false — so `!Number.isFinite` must be an
  // explicit reject rather than relying on the arithmetic below.
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  const skewSeconds = Math.abs(nowMs / 1000 - timestampSeconds);
  if (skewSeconds > toleranceSeconds) return false;

  // The secret is base64 after the `whsec_` prefix.
  const rawSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(rawSecret, 'base64');
  } catch {
    return false;
  }
  if (key.length === 0) return false;

  const signedContent = `${id}.${timestamp}.${payload}`;
  const expected = createHmac('sha256', key)
    .update(signedContent, 'utf8')
    .digest();

  // Header carries one or more space-delimited `version,signature` pairs.
  for (const part of signature.split(' ')) {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) continue;
    let provided: Buffer;
    try {
      provided = Buffer.from(sig, 'base64');
    } catch {
      continue;
    }
    if (
      provided.length === expected.length &&
      timingSafeEqual(provided, expected)
    ) {
      return true;
    }
  }
  return false;
}
