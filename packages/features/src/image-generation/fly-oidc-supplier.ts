/**
 * Fly.io OIDC → Google Cloud Workload Identity Federation.
 *
 * WHY A CUSTOM SUPPLIER
 *
 * GCP's stock external-account credential sources read the subject token from
 * a FILE, or from a URL via **GET**. Fly's OIDC endpoint is a **POST** that
 * takes the desired `aud` in the body, so neither stock source fits. The
 * documented workaround is an *executable*-sourced credential, which means
 * shipping a helper script and setting
 * `GOOGLE_EXTERNAL_ACCOUNT_ALLOW_EXECUTABLES=1` — an escape hatch that widens
 * what the auth library is allowed to run.
 *
 * `IdentityPoolClient` instead accepts a `subject_token_supplier`: we hand it
 * the JWT, and it still owns the STS exchange, the optional service-account
 * impersonation, and access-token refresh. Same result as WIF-by-config, no
 * helper script, no executable flag, and it is unit-testable.
 *
 * Net effect: no long-lived Google credential exists anywhere for Fly.
 */

import { request as httpRequest } from 'node:http';
import type {
  ExternalAccountSupplierContext,
  SubjectTokenSupplier,
} from 'google-auth-library';

/**
 * Fly exposes the OIDC token endpoint on a machine-local UNIX SOCKET, not over
 * the network. `_api.internal:4280` is the *Machines API*, which needs its own
 * Fly API token and does NOT serve this — using it fails.
 *
 * The socket being machine-local is part of the security story: nothing
 * off-machine can ask for these tokens. It also means `fetch()` is unusable
 * (undici has no socket-path option without a custom dispatcher), hence
 * node:http, which takes `socketPath` directly.
 */
const FLY_API_SOCKET = '/.fly/api';
const FLY_OIDC_PATH = '/v1/tokens/oidc';
const FLY_OIDC_TIMEOUT_MS = 10_000;

/** POST to the machine-local Fly API socket. */
function postToFlySocket(
  body: string
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        socketPath: FLY_API_SOCKET,
        path: FLY_OIDC_PATH,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
        timeout: FLY_OIDC_TIMEOUT_MS,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: data })
        );
      }
    );
    // `timeout` only fires the event; it does not abort. Destroy explicitly so
    // a hung socket can't pin an image job open.
    req.on('timeout', () => {
      req.destroy(new Error('Fly OIDC token request timed out'));
    });
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * Refresh this many ms before the JWT's own `exp`. Covers clock skew between
 * Fly and Google plus the STS round-trip, so we never present a token that
 * expires mid-exchange.
 */
const EXPIRY_SKEW_MS = 60_000;

/** Decode a JWT's `exp` (seconds since epoch) without verifying the signature.
 *  We are not validating the token — Google does that — only reading when to
 *  stop reusing it. Returns null when the shape is unexpected. */
export function readJwtExpiryMs(jwt: string): number | null {
  const payload = jwt.split('.')[1];
  if (!payload) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    ) as { exp?: number };
    return typeof decoded.exp === 'number' ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Fly returns either a bare JWT or a JSON envelope depending on version.
 * Accept both rather than pinning to one and breaking on a Fly-side change.
 */
export function extractFlyToken(body: string): string | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { token?: string; jwt?: string };
      return parsed.token ?? parsed.jwt ?? null;
    } catch {
      return null;
    }
  }
  // A bare JWT: three base64url segments.
  return trimmed.split('.').length === 3 ? trimmed : null;
}

/**
 * Supplies Fly Machine OIDC tokens to `IdentityPoolClient`.
 *
 * The library explicitly does NOT cache what a supplier returns, so caching is
 * this class's job — without it every image generation would mint a fresh JWT.
 */
export class FlyOidcSubjectTokenSupplier implements SubjectTokenSupplier {
  private cached: { token: string; expiresAtMs: number } | null = null;

  async getSubjectToken(
    context: ExternalAccountSupplierContext
  ): Promise<string> {
    const now = Date.now();
    if (this.cached && now < this.cached.expiresAtMs - EXPIRY_SKEW_MS) {
      return this.cached.token;
    }

    // The `aud` must match the workload identity pool provider exactly, or
    // Google rejects the exchange. `context.audience` is that value, supplied
    // by the client — so we never hard-code it. (Fly defaults `aud` to
    // https://fly.io/<org>, which Google would reject.)
    const response = await postToFlySocket(
      JSON.stringify({ aud: context.audience })
    );

    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `Fly OIDC token request failed with HTTP ${response.status}`
      );
    }

    const token = extractFlyToken(response.body);
    if (!token) {
      throw new Error('Fly OIDC endpoint returned no usable token');
    }

    // Fall back to a conservative 5 minutes when `exp` can't be read, so an
    // unreadable token is re-minted often rather than cached until it fails.
    const expiresAtMs = readJwtExpiryMs(token) ?? now + 5 * 60_000;
    this.cached = { token, expiresAtMs };
    return token;
  }

  /** Drop the cached token. Testing only. */
  reset(): void {
    this.cached = null;
  }
}
