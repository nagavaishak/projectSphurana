/**
 * Meta Conversions API + pixel (dataset) management.
 *
 * Split from `meta-ads` deliberately: that module is the Marketing API
 * (campaigns, ad sets, creatives) and carries its own rate-limit and retry
 * policy. Conversions run on a different edge, with different failure
 * semantics — a CAPI failure is fire-and-forget, an ad-launch failure is not.
 */

export {
  CAPI_MAX_EVENT_AGE_SECONDS,
  MetaCapiService,
  isWithinCapiWindow,
} from './meta-capi.service.js';

export {
  hashUserData,
  hasMatchKey,
  normalizeCountry,
  normalizeDateOfBirth,
  normalizeEmail,
  normalizeGender,
  normalizeName,
  normalizePhone,
  normalizeZip,
  type HashedUserData,
  type RawUserData,
} from './hash-user-data.js';

export {
  MetaPixelsService,
  type MetaAdsPixel,
  type MetaPixelsCredentials,
} from './meta-pixels.service.js';

export type {
  MetaCapiActionSource,
  MetaCapiCredentials,
  MetaCapiCustomData,
  MetaCapiEvent,
  MetaCapiEventInput,
  MetaCapiEventName,
  MetaCapiSendResult,
} from './meta-capi.types.js';
