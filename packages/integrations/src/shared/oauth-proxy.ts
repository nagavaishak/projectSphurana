import crypto from 'node:crypto';

// Shared client-side helpers for OAuth providers that route through the
// webhook-router proxy. The proxy is the single registered redirect_uri
// per provider (Meta, Stripe Connect, Google, etc.); this module is what
// initiating services (api, prod api) use to:
//
//   1. Compute that registered redirect_uri to put into the OAuth URL.
//   2. Wrap their CSRF state with origin + actual callback path so the
//      proxy can route back here on completion.
//
// Both must be set in env for proxying to be active:
//   OAUTH_PROXY_BASE_URL    e.g. "https://borradh-webhooks.fly.dev"
//   OAUTH_PROXY_STATE_SECRET 32+ char shared secret (same value on the
//                            router and on every signer).
//
// Plus the originating service needs to know its own externally reachable
// URL via API_URL so the proxy can redirect callbacks back to it.

export interface OAuthProxyConfig {
  baseUrl: string;
  stateSecret: string;
  selfOrigin: string;
}

export function getOAuthProxyConfig(): OAuthProxyConfig | null {
  const baseUrl = process.env.OAUTH_PROXY_BASE_URL;
  const stateSecret = process.env.OAUTH_PROXY_STATE_SECRET;
  const selfOrigin = process.env.API_URL;
  if (!baseUrl || !stateSecret || !selfOrigin) return null;
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    stateSecret,
    selfOrigin: selfOrigin.replace(/\/$/, ''),
  };
}

/**
 * Returns the URL to register with the provider AND to use as redirect_uri
 * during the auth-dialog request and the code-for-token exchange. They
 * must match exactly per the OAuth 2.0 spec.
 */
export function getProxyRedirectUri(provider: string): string | null {
  const cfg = getOAuthProxyConfig();
  if (!cfg) return null;
  return `${cfg.baseUrl}/oauth/${provider}/callback`;
}

/**
 * HMAC-sign a state-wrapper that the proxy will validate and unwrap. The
 * proxy then redirects to `<origin><callbackPath>?code=...&state=<inner>`,
 * preserving every other query param the provider sent.
 */
export function signProxyState(
  payload: { callbackPath: string; inner?: string },
  cfg = getOAuthProxyConfig()
): string | null {
  if (!cfg) return null;
  if (!payload.callbackPath.startsWith('/')) {
    throw new Error('callbackPath must start with /');
  }
  const body = JSON.stringify({
    origin: cfg.selfOrigin,
    callbackPath: payload.callbackPath,
    inner: payload.inner,
    ts: Math.floor(Date.now() / 1000),
  });
  const body64 = Buffer.from(body).toString('base64url');
  const sig = crypto
    .createHmac('sha256', cfg.stateSecret)
    .update(body64)
    .digest('base64url');
  return `${body64}.${sig}`;
}

/**
 * Convenience: returns either the proxy redirect URI + signed state when
 * the proxy is configured, or null + the inner state untouched when it
 * isn't (local dev / pre-rollout). Callers can pass through to providers
 * either way without branching themselves.
 */
export function buildOAuthProxyParams(
  provider: string,
  args: { callbackPath: string; inner?: string },
  fallbackRedirectUri?: string
): { redirectUri: string; state: string | undefined } {
  const cfg = getOAuthProxyConfig();
  if (!cfg) {
    if (!fallbackRedirectUri) {
      throw new Error(
        `OAuth proxy not configured and no fallback redirect URI given for ${provider}`
      );
    }
    return { redirectUri: fallbackRedirectUri, state: args.inner };
  }
  const state = signProxyState(args, cfg);
  return {
    redirectUri: `${cfg.baseUrl}/oauth/${provider}/callback`,
    state: state ?? undefined,
  };
}
