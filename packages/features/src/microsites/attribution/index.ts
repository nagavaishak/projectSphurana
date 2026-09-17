/**
 * Microsite attribution — the loop that closes CAC (plan §9, §11).
 *
 * `utm.ts` decides WHAT we tag traffic with, `attach-lead-attribution` lands it
 * on the lead, `compute-campaign-cac` joins it back to spend. The one invariant
 * running through all three: the key is `micrositeId` + the Meta campaign id,
 * never the host — so a custom-domain move costs a tenant nothing.
 */
export * from './attach-lead-attribution/index.js';
export * from './compute-campaign-cac/index.js';
export {
  META_UTM_MEDIUM,
  META_UTM_SOURCE,
  type MicrositeUtm,
  appendUtmParams,
  hasUtm,
  metaCampaignUtm,
  parseUtmParams,
} from './utm.js';
