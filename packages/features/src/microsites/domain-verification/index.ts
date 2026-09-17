/**
 * Custom-domain verification (contract §2 steps 3–4 and §4).
 *
 * Deliberately NOT re-exported from `../index.js`: the queue producer pulls in
 * bullmq + ioredis, and the microsites barrel is imported by the Astro
 * renderer. Import this path directly from the API and the worker.
 */

export {
  hasExhaustedVerification,
  isDueForVerification,
  nextVerificationDelayMs,
  type DueInput,
} from './backoff.js';
export {
  DOMAIN_CHANGED_JOB,
  HOST_CACHE_KEY,
  MICROSITE_DOMAIN_QUEUE,
  SWEEP_INTERVAL_MS,
  VERIFY_BACKOFF_LADDER,
  VERIFY_BACKOFF_MAX_MS,
  VERIFY_GIVE_UP_MS,
  VERIFY_SWEEP_JOB,
} from './domain-verification.constants.js';
export {
  domainChangedJobSchema,
  verifySweepJobSchema,
  type DomainChangedJobPayload,
  type VerifySweepJobPayload,
} from './domain-verification.schema.js';
export {
  checkDomainNow,
  checkDomainNowSchema,
  type CheckDomainNowInput,
} from './check-domain-now.service.js';
export {
  changePrimaryDomain,
  type ChangePrimaryDomainDeps,
  type ChangePrimaryDomainOutput,
} from './change-primary-domain.service.js';
export {
  closeMicrositeDomainQueue,
  ensureMicrositeDomainSweepSchedule,
  enqueueDomainChanged,
  getMicrositeDomainQueue,
} from './domain-queue.js';
export {
  processMicrositeDomainJob,
  type MicrositeDomainJob,
} from './domain-worker.js';
export { bustMicrositeHostCache } from './host-cache.js';
export {
  handleDomainChanged,
  type DomainChangedOutput,
} from './handle-domain-changed.service.js';
export {
  ensureMetaDomainVerification,
  getMetaVerificationToken,
  syncMicrositeMetaDomains,
  META_DOMAIN_VERIFY_TAG_NAME,
  META_VERIFICATION_KEY,
  NEEDS_HUMAN,
  type EnsureMetaDomainVerificationOutput,
  type MetaDomainVerificationState,
  type MetaVerificationOutcome,
} from './meta-verification/index.js';
export {
  requestMetaDomainVerification,
  type RequestMetaDomainVerificationInput,
} from './request-meta-domain-verification.service.js';
export {
  rewriteAdDestinations,
  swapUrlHost,
  type RewriteAdDestinationsDeps,
  type RewriteAdDestinationsInput,
  type RewriteAdDestinationsOutput,
} from './rewrite-ad-destinations.service.js';
export {
  sweepDomainVerifications,
  type SweepOutput,
} from './sweep-domain-verifications.service.js';
export {
  providerSaysVerified,
  verifyMicrositeDomain,
  type VerifyDomainOutcome,
  type VerifyMicrositeDomainDeps,
  type VerifyMicrositeDomainOutput,
} from './verify-microsite-domain.service.js';
