import crypto from 'node:crypto';
import { z } from 'zod';

// HMAC-signed wrapper around the OAuth `state` parameter. Lets us register
// a single redirect_uri (this proxy) with providers that require exact
// match (Meta, Stripe Connect, Google) and still route the callback back
// to the originating preview / prod instance.
//
// Wire format: <base64url(JSON body)>.<base64url(HMAC-SHA256 signature)>
//
//   body = {
//     origin: "https://...",
//     callbackPath?: "/integrations/meta-ads/callback",
//     inner?: string,
//     ts: number,
//   }
//
// `callbackPath` is the relative path on origin where the proxy should
// forward the callback. When omitted, defaults to /auth/{provider}/callback
// for backward compatibility with the initial proxy launch.
//
// `inner` carries the originating service's own opaque state (typically a
// CSRF token); the proxy never inspects it. `ts` is unix seconds — states
// older than STATE_TTL_SEC are rejected.

const STATE_TTL_SEC = 600; // 10 min

const stateSchema = z.object({
  origin: z.string().url(),
  callbackPath: z
    .string()
    .startsWith('/')
    .regex(/^[^?#]*$/, 'callbackPath must not contain ? or #')
    .optional(),
  inner: z.string().optional(),
  ts: z.number().int().positive(),
});

export function signState(
  secret: string,
  payload: { origin: string; callbackPath?: string; inner?: string }
): string {
  const body = JSON.stringify({
    origin: payload.origin,
    callbackPath: payload.callbackPath,
    inner: payload.inner,
    ts: Math.floor(Date.now() / 1000),
  });
  const body64 = Buffer.from(body).toString('base64url');
  const sig = crypto
    .createHmac('sha256', secret)
    .update(body64)
    .digest('base64url');
  return `${body64}.${sig}`;
}

export type VerifyResult =
  | { origin: string; callbackPath?: string; inner?: string }
  | { error: string };

export function verifyState(
  secret: string,
  state: string,
  allowedOriginPatterns: RegExp[]
): VerifyResult {
  const parts = state.split('.');
  if (parts.length !== 2) return { error: 'malformed state' };
  const [body64, sig] = parts;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(body64)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (
    sigBuf.length !== expBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expBuf)
  ) {
    return { error: 'bad signature' };
  }

  let parsed: ReturnType<typeof stateSchema.parse>;
  try {
    const body = Buffer.from(body64, 'base64url').toString();
    parsed = stateSchema.parse(JSON.parse(body));
  } catch {
    return { error: 'malformed body' };
  }

  if (Math.floor(Date.now() / 1000) - parsed.ts > STATE_TTL_SEC) {
    return { error: 'state expired' };
  }
  if (!allowedOriginPatterns.some((p) => p.test(parsed.origin))) {
    return { error: 'origin not allowed' };
  }

  return {
    origin: parsed.origin,
    callbackPath: parsed.callbackPath,
    inner: parsed.inner,
  };
}
