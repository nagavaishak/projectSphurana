/**
 * MAGIC IDS — deterministic Meta failures, on demand.
 *
 * Stripe ships card number `4000000000000002` so you can test the DECLINE path
 * without a real decline. This is the same idea for Graph.
 *
 * WHY THIS EXISTS
 * ---------------
 * Our Meta error handling was effectively untestable. You cannot ask Meta to
 * rate-limit you, revoke your token, or disapprove an ad on cue — which is
 * exactly why `skipIfMetaRateLimited()` had to be written: a helper whose only
 * job is to GIVE UP on a code path we had no way to trigger.
 *
 * So `apiRequest`'s code-17 backoff, `MetaAppSecretMismatchError`, the
 * `META_AUTH_EXPIRED` reconnect flow and the disapproved-ad surface have never
 * run in CI. Put one of these tokens in an id the request touches — an ad
 * account, a page, a recipient — and the fake returns the corresponding Meta
 * error envelope.
 *
 * IMPORTANT: the fake emits Meta-SHAPED errors and lets our own
 * `parseMetaErrorResponse` / `meta-error-registry` classify them. It never
 * short-circuits to our internal error types. The classification logic is part
 * of what we're testing.
 */

export interface MetaErrorEnvelope {
  status: number;
  body: {
    error: {
      message: string;
      type: string;
      code: number;
      error_subcode?: number;
      fbtrace_id: string;
    };
  };
}

/** Sentinel → the Meta failure it provokes. */
export const MAGIC_IDS = {
  /** User-level request limit. The reason connected-ads runs --workers=1. */
  E2ERATELIMIT: 'rate-limit',
  /** Token revoked / expired → drives the reconnect banner. */
  E2EAUTHREVOKED: 'auth-revoked',
  /** appsecret_proof mismatch → MetaAppSecretMismatchError. */
  E2EAPPSECRET: 'appsecret-mismatch',
  /** Ad reaches DISAPPROVED instead of ACTIVE. */
  E2EDISAPPROVED: 'ad-disapproved',
  /** Never responds → FetchTimeoutError via the seam's abort race. */
  E2ETIMEOUT: 'timeout',
  /**
   * Generic permission failure (code 10) → `META_PERMISSION_GENERIC` /
   * `permission_denied` → `ErrorCodes.FORBIDDEN`. Drives the 403 mapping in
   * the meta-ads controller (ENG-852): unmapped, FORBIDDEN fell to a 500 and
   * the sanitize filter scrubbed the actionable copy.
   */
  E2EPERMISSION: 'permission-denied',
} as const;

export type MagicBehaviour = (typeof MAGIC_IDS)[keyof typeof MAGIC_IDS];

const FBTRACE = 'E2EFAKETRACE0000';

const ENVELOPES: Record<
  Exclude<MagicBehaviour, 'timeout' | 'ad-disapproved'>,
  MetaErrorEnvelope
> = {
  'rate-limit': {
    status: 400,
    body: {
      error: {
        message: '(#17) User request limit reached',
        type: 'OAuthException',
        code: 17,
        fbtrace_id: FBTRACE,
      },
    },
  },
  'auth-revoked': {
    status: 400,
    body: {
      error: {
        message:
          'Error validating access token: The user has not authorized application. The access token has been revoked.',
        type: 'OAuthException',
        code: 190,
        error_subcode: 458,
        fbtrace_id: FBTRACE,
      },
    },
  },
  'appsecret-mismatch': {
    status: 400,
    body: {
      error: {
        message: 'Invalid appsecret_proof provided in the API argument',
        type: 'OAuthException',
        code: 1,
        error_subcode: 2_207_083,
        fbtrace_id: FBTRACE,
      },
    },
  },
  'permission-denied': {
    status: 400,
    body: {
      error: {
        message: '(#10) Application does not have permission for this action',
        type: 'OAuthException',
        code: 10,
        fbtrace_id: FBTRACE,
      },
    },
  },
};

/**
 * Find a magic sentinel anywhere in the request.
 *
 * Scans the path AND the serialised body, because which field carries the id
 * differs per endpoint — the ad account is in the path for
 * `POST /act_X/ads`, but the recipient is in the body for `POST /me/messages`.
 * A substring scan keeps the fake from needing per-endpoint knowledge of where
 * ids live.
 */
export function detectMagicBehaviour(
  path: string,
  body: string | null
): MagicBehaviour | null {
  const haystack = `${path}\n${body ?? ''}`;
  for (const [token, behaviour] of Object.entries(MAGIC_IDS)) {
    if (haystack.includes(token)) return behaviour;
  }
  return null;
}

/** The Meta error envelope for a behaviour, or null if it isn't an error. */
export function envelopeFor(
  behaviour: MagicBehaviour
): MetaErrorEnvelope | null {
  if (behaviour === 'timeout' || behaviour === 'ad-disapproved') return null;
  return ENVELOPES[behaviour];
}
