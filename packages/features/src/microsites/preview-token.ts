import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed preview tokens — the ONLY way a draft microsite is served publicly.
 *
 * The public document route refuses `mode=draft` outright, because an anonymous
 * caller asking for a draft would be an open door onto whatever the agent last
 * wrote, including copy the owner has not seen yet. This is the documented
 * exception (plan §9): a short-lived token, minted for an owner who has already
 * been authorized, that says "this specific microsite's draft, until this time".
 *
 * Stateless on purpose. The manage-booking and intake-form tokens store a hash
 * per token because they must be revocable and single-use; a preview token is
 * neither — it is a read-only view that expires on its own, and a row per
 * editor page-load would be pure cost.
 *
 * KEY DERIVATION follows `shared/oauth-state.ts`: an HMAC of a domain string
 * under `BETTER_AUTH_SECRET`. The domain separation matters — it means a preview
 * token can never be replayed as OAuth state, or the reverse, even though both
 * ultimately derive from the same secret.
 */

const DOMAIN = 'microsite-preview-v1';

/** Long enough to survive an editing session, short enough that a leaked URL dies. */
export const PREVIEW_TOKEN_TTL_SECONDS = 60 * 60;

function signingKey(): Buffer | null {
  const secret = process.env.BETTER_AUTH_SECRET;
  // A missing or weak secret means we cannot make an unforgeable claim. Return
  // null and let callers fail CLOSED rather than mint something guessable.
  if (!secret || secret.length < 32) return null;
  return createHmac('sha256', secret).update(DOMAIN).digest();
}

const sign = (key: Buffer, payload: string): string =>
  createHmac('sha256', key).update(payload).digest('base64url');

/**
 * Mint a token for one microsite. Returns null when no adequate secret is
 * configured — the caller must then omit the preview URL entirely rather than
 * emit an unsigned one.
 */
export function mintPreviewToken(
  micrositeId: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): string | null {
  const key = signingKey();
  if (!key) return null;
  const exp = nowSeconds + PREVIEW_TOKEN_TTL_SECONDS;
  return `${exp}.${sign(key, `${micrositeId}.${exp}`)}`;
}

/**
 * Verify a token against the microsite it is being used for.
 *
 * Binding to `micrositeId` is the point: without it, a token minted for the
 * tenant's own site would read any other tenant's draft. The id comes from the
 * route, never from the token.
 */
export function verifyPreviewToken(
  micrositeId: string,
  token: string | undefined | null,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): boolean {
  if (!token) return false;
  const key = signingKey();
  if (!key) return false;

  const separator = token.indexOf('.');
  if (separator <= 0) return false;
  const exp = Number(token.slice(0, separator));
  const provided = token.slice(separator + 1);
  if (!Number.isSafeInteger(exp) || exp <= nowSeconds) return false;

  const expected = sign(key, `${micrositeId}.${exp}`);
  // Compare as bytes of equal length — timingSafeEqual throws on a mismatch,
  // and a length check first would leak the signature length anyway.
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
