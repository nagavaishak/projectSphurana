/**
 * Custom-domain provisioning.
 *
 * Consumers import the PORT (`DomainProvider` and its shapes) from here and
 * should never name the adapter except at the single wiring site that builds
 * one. See `domain-provider.ts` for why that rule is load-bearing.
 */

export {
  DomainProviderErrorCodes,
  providerErr,
  providerOk,
  type AddedDomain,
  type DomainDnsRecord,
  type DomainProvider,
  type DomainProviderError,
  type DomainProviderErrorCode,
  type DomainProviderResult,
  type DomainState,
  type DomainStatus,
  type RemovedDomain,
} from './domain-provider.js';

export {
  VERCEL_APEX_A_RECORD,
  VERCEL_WWW_CNAME_TARGET,
  VercelDomainProvider,
  createVercelDomainProvider,
  vercelRoutingRecords,
  type VercelDomainProviderOptions,
} from './vercel-domain-provider.js';
