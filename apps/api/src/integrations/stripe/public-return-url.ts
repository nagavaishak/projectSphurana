import { webOrigin } from '../../common/oauth/index.js';
import { isKnownWebOrigin } from '../../common/origins/index.js';

/**
 * Hosts that are well-formed URLs but unreachable from outside this device.
 * Stripe rejects a live-mode Account Link pointing at any of them with
 * "You cannot redirect to localhost in a livemode request."
 */
const LOOPBACK_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
]);

/** Schemes a browser can follow back to us. Capacitor's are not among them. */
const WEB_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Force a client-supplied Stripe return/refresh URL onto an origin we own,
 * keeping the path, query and hash the client chose.
 *
 * Two separate reasons this runs on the server:
 *
 * 1. STALE NATIVE BUNDLES. The app bakes its public origin at BUILD time, so a
 *    device running an older bundle keeps sending `https://localhost` long
 *    after the client-side fix (#666) shipped — every one of those installs
 *    gets a dead Connect onboarding until its owner updates the app, which we
 *    do not control. Rebasing here repairs all of them at once. This is the
 *    case seen in production (API-6T: Android WebView, `https://localhost`).
 *    Note that `capacitor://localhost` / `ionic://localhost` cannot reach this
 *    function through `POST /integrations/stripe/account-link` — the contract's
 *    `externalRedirectUrl` rejects any non-http(s) scheme with a 400 first. The
 *    protocol check below is defence in depth for any future caller that is not
 *    behind that schema, not a live repair path.
 *
 * 2. UNTRUSTED ORIGINS. `externalRedirectUrl` accepts ANY https URL, so without
 *    this the API would hand Stripe an attacker-supplied `https://evil.com/...`
 *    and Stripe would walk the user there at the end of onboarding. The origin
 *    is therefore checked against our own front-ends (`isKnownWebOrigin`, the
 *    same list CORS uses, plus whatever `webOrigin()` resolves to) and anything
 *    else is rebased onto `webOrigin()`. Only the ORIGIN is replaced, so a
 *    legitimate preview or dev origin survives untouched and this does not pin
 *    every environment to production's `APP_URL`.
 *
 * In local dev `webOrigin()` is itself a localhost URL — correct, because there
 * Stripe is in test mode and accepts it.
 */
export function publicReturnUrl(candidate: string): string {
  // Deliberately NOT a validator. Anything that is not a well-formed absolute
  // URL — absent, relative, garbage — is passed through untouched so the
  // existing schema validation still rejects it with a 400. Repairing those
  // here would turn "malformed input" into a silently accepted request.
  if (typeof candidate !== 'string') return candidate;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return candidate;
  }

  if (isOwnRedirectTarget(parsed)) return candidate;

  return new URL(
    `${parsed.pathname}${parsed.search}${parsed.hash}`,
    webOrigin()
  ).toString();
}

/**
 * Unreachable schemes and loopback hosts are ruled out BEFORE the allow-list,
 * because the CORS list legitimately contains `capacitor://localhost` and
 * `https://localhost` — origins a native WebView really sends, and which are
 * still useless as a redirect target.
 */
function isOwnRedirectTarget(parsed: URL): boolean {
  if (!WEB_PROTOCOLS.has(parsed.protocol)) return false;
  if (LOOPBACK_HOSTS.has(parsed.hostname)) return false;
  if (parsed.origin === ownOrigin()) return true;
  return isKnownWebOrigin(parsed.origin);
}

/** `webOrigin()` as a bare origin, or null if it is not a parseable URL. */
function ownOrigin(): string | null {
  try {
    return new URL(webOrigin()).origin;
  } catch {
    return null;
  }
}
