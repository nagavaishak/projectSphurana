/**
 * Meta business-owned domains — claim + verification-status polling.
 *
 * Separate from `meta-ads` (Marketing API) and `meta-capi` (Conversions):
 * this is the BUSINESS edge, with its own permission and its own blocking
 * failure mode (unverified Business Manager).
 */

export {
  MetaOwnedDomainsService,
  fetchAdAccountBusinessId,
  type ClaimDomainOutcome,
  type ClaimDomainResult,
  type MetaOwnedDomain,
  type MetaOwnedDomainsCredentials,
} from './meta-domains.service.js';

export {
  MetaOwnedDomainError,
  classifyOwnedDomainError,
  toOwnedDomainError,
  type MetaOwnedDomainFailureReason,
} from './meta-domains.errors.js';
