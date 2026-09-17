/**
 * Meta domain verification — plan §11.
 *
 * Entry points, and nothing else:
 *   - `ensureMetaDomainVerification` — the write side, called on publish and
 *     on every custom-domain activation. Idempotent, never fatal.
 *   - `syncMicrositeMetaDomains` — the publish-side sweep over a site's live
 *     custom hosts, which is how a host that missed its activation trigger
 *     repairs itself.
 *   - `getMetaVerificationToken` — the renderer's read, by host.
 */

export {
  ensureMetaDomainVerification,
  type EnsureMetaDomainVerificationInput,
  type EnsureMetaDomainVerificationOutput,
  type EnsureMetaDomainVerificationResult,
} from './ensure-meta-domain-verification.service.js';

export {
  syncMicrositeMetaDomains,
  type SyncMicrositeMetaDomainsOutput,
} from './sync-microsite-meta-domains.service.js';

export {
  getMetaVerificationToken,
  META_DOMAIN_VERIFY_TAG_NAME,
} from './get-meta-verification-token.service.js';

export {
  IS_HEALTHY,
  META_VERIFICATION_KEY,
  NEEDS_HUMAN,
  type MetaDomainVerificationState,
  type MetaVerificationOutcome,
} from './meta-verification.types.js';
