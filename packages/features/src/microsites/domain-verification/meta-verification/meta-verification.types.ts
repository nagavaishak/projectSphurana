/**
 * What one attempt at Meta domain verification concluded — and whether a
 * person has to do something about it.
 *
 * Kept apart from the service so the renderer-facing read helper and the
 * poller can both name these states without importing the whole flow (and
 * with it the Meta client).
 */

export type MetaVerificationOutcome =
  /** Meta reports the domain VERIFIED. The end state; nothing more is owed. */
  | 'verified'
  /** We claimed it just now; Meta still has to fetch our meta tag. */
  | 'claimed'
  /** The business already owned it, not yet verified. Normal, keep polling. */
  | 'already_owned'
  /** Owned, but Meta gave us no code to serve — a human must paste the tag. */
  | 'token_unavailable'
  /** Claimed in a DIFFERENT Business Manager. Retrying never fixes this. */
  | 'conflict'
  /** The tenant's Business Manager has not completed Business Verification. */
  | 'business_unverified'
  /** Our token cannot manage this business — reconnect with an admin. */
  | 'permission_denied'
  /** No Meta Ads integration on the org. Nothing to verify against, yet. */
  | 'meta_not_configured'
  /** `{slug}.borradh.io` — our apex, ours to verify, not the tenant's. */
  | 'shared_apex'
  /** No `microsite_domain` row for the host, so nowhere to store a token. */
  | 'unknown_host'
  /** Meta was unavailable / rate limited. The poller retries. */
  | 'transient_failure';

/** Outcomes that no amount of retrying will resolve. */
export const NEEDS_HUMAN: ReadonlySet<MetaVerificationOutcome> = new Set([
  'conflict',
  'business_unverified',
  'permission_denied',
  'token_unavailable',
]);

/** Outcomes where the domain is (or is becoming) verified under our control. */
export const IS_HEALTHY: ReadonlySet<MetaVerificationOutcome> = new Set([
  'verified',
  'claimed',
  'already_owned',
]);

/**
 * The slice of `microsite_domain.verification` this flow owns, under the key
 * {@link META_VERIFICATION_KEY}. Everything else in that jsonb belongs to the
 * DNS provider and is never touched here.
 *
 * `token` is the only secret-ish value in it. It is safe to SERVE (it is a
 * public meta tag by design) but it is never logged, and the read path that
 * hands it to the renderer is deliberately narrow.
 */
export interface MetaDomainVerificationState {
  outcome: MetaVerificationOutcome;
  businessId?: string;
  ownedDomainId?: string;
  /** `<meta name="facebook-domain-verify" content="…">`. */
  token?: string;
  /** Meta's own `verification_status` string, recorded verbatim. */
  metaStatus?: string;
  checkedAt: string;
  /** Which outcome we last emailed about — dedups across poller retries. */
  notifiedOutcome?: MetaVerificationOutcome;
  notifiedAt?: string;
}

/** The key inside `microsite_domain.verification` this flow writes. */
export const META_VERIFICATION_KEY = 'meta' as const;

/**
 * The `name` attribute Meta looks for. Renderer and tests share it — which is
 * why it is DEFINED in `@borradh-workspace/web-shared` and only re-exported
 * here: the Astro renderer that emits the tag cannot import this package.
 */
export { META_DOMAIN_VERIFY_TAG_NAME } from '@borradh-workspace/web-shared';
