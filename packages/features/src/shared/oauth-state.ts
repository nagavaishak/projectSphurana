import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Authenticated OAuth `state` for provider connect flows.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every OAuth callback in `integrations.controller.ts` is UNAUTHENTICATED —
 * it has to be, the provider redirects the browser to it with no session
 * guarantee. Each one recovered the acting org and user by base64-decoding the
 * `state` query parameter and trusting its contents:
 *
 *     JSON.parse(Buffer.from(state, 'base64').toString())   // <- attacker input
 *
 * `state` is a value the caller supplies. There was no signature, no nonce and
 * no binding to the session that started the flow, so anyone able to reach the
 * callback could name ANY organization as the one being connected. The concrete
 * exploit needs no special access: start a normal connect flow while signed in,
 * read the `state` out of your own browser's address bar, swap the
 * `organizationId`, and replay the callback. The provider tokens just obtained
 * are then written as another organization's integration.
 *
 * Impact was not uniform. For Stripe Connect it redirects a victim
 * organization's payouts to an attacker-controlled connected account.
 *
 * Two things made this hard to see, and both are worth naming because they are
 * the general lesson, not Stripe trivia:
 *
 *   1. Two callbacks carried a comment saying they bound org context "from the
 *      SIGNED OAuth state". Nothing was ever signed. The comment described an
 *      intention as though it were a mechanism.
 *
 *   2. `connect-stripe.service.ts` looked like it validated the state:
 *
 *          if (statePayload.organizationId !== organizationId) return err(...)
 *
 *      — but `organizationId` was itself decoded from that same `state` blob one
 *      layer up. The check compared the attacker's value against itself and
 *      could never fail. A tautology shaped exactly like a control is worse than
 *      no control, because it retires the worry.
 *
 * The `nonce: randomUUID()` in the Stripe state was the same kind of thing: it
 * was generated, never persisted, and therefore never checkable.
 *
 * NOT the same thing as the proxy signature. `packages/integrations/src/shared/
 * oauth-proxy.ts` HMACs an OUTER envelope carrying `origin` + `callbackPath`, so
 * the webhook router knows which deployment to hand the callback back to. The
 * router strips it and forwards `state=<inner>`. That signature authenticates
 * ROUTING; this one authenticates IDENTITY. They are different claims and the
 * outer one never covered the inner payload.
 *
 * THE SCHEME
 * ----------
 *   state = base64url(JSON(payload)) + "." + base64url(HMAC-SHA256(key, body))
 *
 * The key is derived from `BETTER_AUTH_SECRET` — the one secret the API is
 * guaranteed to have (`packages/env/src/auth.ts` requires it, min 32 chars) —
 * with a domain-separation label so this signature can never be confused with,
 * or substituted for, a session token.
 *
 * Fail-closed everywhere: an unsigned, forged, truncated, expired or
 * wrong-provider state verifies to `null`, and callers turn that into the same
 * friendly "Connection expired. Please try again." redirect that a malformed
 * state already produced.
 *
 * DEPLOY NOTE: this is deliberately NOT backward compatible. A flow already in
 * flight when this ships carries an unsigned state and will be rejected, and the
 * user retries. Accepting unsigned states for a grace period would leave the
 * vulnerability fully open for the length of the grace period, which is the
 * entire thing being closed.
 */

const DOMAIN = 'borradh.oauth-state.v1';

/** OAuth round trips are quick; Stripe Connect's form is the slow one. */
export const OAUTH_STATE_MAX_AGE_MS = 30 * 60 * 1000;

export interface OAuthStatePayload {
  organizationId: string;
  provider: string;
  /** Absent for flows started before a user id was carried (e.g. gmail). */
  userId?: string;
  /** Relative path to send the browser back to. Never absolute — see below. */
  returnTo?: string;
  /** Millisecond epoch, stamped at mint time. */
  timestamp: number;
}

function signingKey(): Buffer | null {
  const secret = process.env.BETTER_AUTH_SECRET;
  // A short or missing secret means we cannot make an unforgeable claim. Say so
  // by refusing rather than by signing with something weak.
  if (!secret || secret.length < 32) return null;
  return createHmac('sha256', secret).update(DOMAIN).digest();
}

function mac(key: Buffer, body: string): string {
  return createHmac('sha256', key).update(body).digest('base64url');
}

/**
 * Mint a signed state. Returns `null` when no adequate signing secret is
 * configured, so callers fail the flow up front instead of emitting a state
 * that will not verify on the way back.
 */
export function signOAuthState(
  payload: Omit<OAuthStatePayload, 'timestamp'> & { timestamp?: number }
): string | null {
  const key = signingKey();
  if (!key) return null;
  const body = Buffer.from(
    JSON.stringify({ ...payload, timestamp: payload.timestamp ?? Date.now() })
  ).toString('base64url');
  return `${body}.${mac(key, body)}`;
}

/**
 * Verify and decode a state. Returns `null` for every failure mode — missing,
 * malformed, unsigned, forged, expired, or signed for a different provider.
 *
 * `expectedProvider` matters: without it a state minted for one provider's
 * callback would verify at another's, letting a caller who can legitimately
 * start a Gmail connect drive the Stripe callback with the same blob.
 */
export function verifyOAuthState(
  state: string | undefined,
  expectedProvider: string,
  now: number = Date.now()
): OAuthStatePayload | null {
  if (!state) return null;
  const key = signingKey();
  if (!key) return null;

  const dot = state.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = state.slice(0, dot);
  const given = state.slice(dot + 1);

  const expected = mac(key, body);
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let parsed: Partial<OAuthStatePayload>;
  try {
    parsed = JSON.parse(
      Buffer.from(body, 'base64url').toString()
    ) as Partial<OAuthStatePayload>;
  } catch {
    return null;
  }

  if (!parsed.organizationId || !parsed.provider) return null;
  if (parsed.provider !== expectedProvider) return null;
  if (typeof parsed.timestamp !== 'number') return null;
  if (now - parsed.timestamp > OAUTH_STATE_MAX_AGE_MS) return null;
  // A clock-skew allowance in one direction only; a state stamped in the future
  // is not something we ever mint.
  if (parsed.timestamp - now > 60_000) return null;

  return {
    organizationId: parsed.organizationId,
    provider: parsed.provider,
    userId: parsed.userId,
    returnTo: parsed.returnTo,
    timestamp: parsed.timestamp,
  };
}

/**
 * Constrain `returnTo` to a same-site relative path, so a signed state can
 * never be turned into an open redirect. Kept here rather than on the
 * controller because it is a property of the payload, not of the transport.
 */
export function safeReturnTo(
  returnTo: string | undefined,
  fallback = '/dashboard/integrations'
): string {
  if (!returnTo) return fallback;
  if (!returnTo.startsWith('/')) return fallback;
  if (returnTo.startsWith('//')) return fallback;
  if (returnTo.includes('://')) return fallback;
  return returnTo;
}
