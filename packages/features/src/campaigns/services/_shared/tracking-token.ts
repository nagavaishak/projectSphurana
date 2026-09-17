import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stateless, signed tokens for the public tracking/unsubscribe surface
 * (`/c/r/:token` click redirect, `/c/o/:token.gif` open pixel,
 * `/c/u/:token` unsubscribe). An HMAC over the payload means the routes verify
 * a token with zero DB lookups and a tampered token is rejected.
 */

export interface TrackingTokenPayload {
  /** recipientId */
  r: string;
  /** channel */
  c: 'email' | 'sms' | 'whatsapp';
  /** target — the destination URL for a click redirect (omitted for pixel/unsub) */
  t?: string;
}

const b64url = (buf: Buffer): string =>
  buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const b64urlToBuf = (s: string): Buffer =>
  Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

const sign = (data: string, secret: string): string =>
  b64url(createHmac('sha256', secret).update(data).digest());

/** Produce a `<payload>.<sig>` token. */
export function signTrackingToken(
  payload: TrackingTokenPayload,
  secret: string
): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${body}.${sign(body, secret)}`;
}

/** Verify + decode a token. Returns null on any tampering/format error. */
export function verifyTrackingToken(
  token: string,
  secret: string
): TrackingTokenPayload | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = sign(body, secret);
  const a = b64urlToBuf(sig);
  const b = b64urlToBuf(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(b64urlToBuf(body).toString('utf8'));
    if (
      parsed &&
      typeof parsed.r === 'string' &&
      (parsed.c === 'email' || parsed.c === 'sms' || parsed.c === 'whatsapp')
    ) {
      return parsed as TrackingTokenPayload;
    }
    return null;
  } catch {
    return null;
  }
}
