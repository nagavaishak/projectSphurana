import { defineCoverage } from '../coverage.types.js';

/**
 * META-ADS — 16 endpoints. Individual ads inside a Meta campaign: the creative,
 * the copy, and the act of putting them in front of paying traffic. The tools
 * live in `tools/ads/` alongside `meta-campaigns`, because an owner does not
 * think in terms of two REST resources — they think "run this ad".
 *
 * This is the area with real money in it, so the exposure line is drawn hard at
 * PUBLICATION. Everything before it — create a draft, rewrite the copy, swap
 * the creative, duplicate a winner — is local rows only and runs unconfirmed.
 * Crossing into live traffic goes through a two-tool split
 * (`meta_ads_confirmLaunchAd` asks, `meta_ads_executeLaunchAd` acts), so
 * `confirm: true` on `POST /meta-ads/:id/publish` describes the PAIR; neither
 * half carries `destructive: true` because the split replaces the factory's own
 * confirmation machinery with an explicit token handshake.
 *
 * `POST /meta-ads/:id/promote-draft` is the same launch reached from the Claire
 * ad-builder flow, where the owner clicks Publish on a preview card —
 * `claire_publishAd` IS `destructive: true` and renders an AdPublishConfirmation.
 *
 * The webhook pair is not a capability at all: `GET` is Meta's subscription
 * handshake and `POST` is its delivery endpoint, both unauthenticated and both
 * meaningless to call from inside a conversation.
 */
export const metaAdsCoverage = defineCoverage('meta-ads', {
  // ---- reads -------------------------------------------------------------
  'GET /meta-ads/campaigns/:metaCampaignId': {
    exposed: 'meta_ads_listRecentAds',
  },

  'GET /meta-ads/:id': {
    notExposed:
      'No single-ad read tool exists. meta_ads_listRecentAds returns the full row per ad, so Claire reaches an ad by listing its campaign; the delete tool re-reads one by id to check it is still a draft, which is a precondition of that write rather than a capability.',
  },
  'GET /meta-ads/health-check': {
    notExposed:
      'A page/Instagram readiness probe for the ad-composer UI, superseded by meta_ads_checkMetaIntegration, which answers the same "can this org run ads yet?" question against the integrations record. Two tools reading one readiness signal is how a model reports the wrong one.',
  },
  'GET /meta-ads/webhook': {
    notExposed:
      "Meta's subscription verification handshake — it echoes a challenge token back during setup. Unauthenticated infrastructure, not a capability, and calling it returns a string with no meaning to anyone.",
  },

  // ---- writes: drafting (local rows, no spend) ---------------------------
  'POST /meta-ads': { exposed: 'meta_ads_createDraftAd', confirm: false },
  'PUT /meta-ads/:id': { exposed: 'meta_ads_updateAd', confirm: false },
  'PUT /meta-ads/:id/creative': {
    exposed: 'meta_ads_replaceAdCreative',
    confirm: false,
  },
  'POST /meta-ads/:id/duplicate': {
    exposed: 'meta_ads_duplicateAd',
    confirm: false,
  },
  'DELETE /meta-ads/:id': { exposed: 'meta_ads_deleteDraftAd', confirm: true },

  // ---- writes: publication -----------------------------------------------
  'POST /meta-ads/:id/publish': {
    exposed: 'meta_ads_executeLaunchAd',
    confirm: true,
  },
  'POST /meta-ads/:id/promote-draft': {
    exposed: 'claire_publishAd',
    confirm: true,
  },

  // ---- writes: withheld ---------------------------------------------------
  'POST /meta-ads/launch': {
    notExposed:
      'The one-shot legacy path that creates and launches an ad in a single call from a fully-specified payload. It bypasses the draft the owner reviews and the confirm/execute split that makes launching deliberate — precisely the gate the two-tool flow exists to enforce.',
  },
  'POST /meta-ads/launch-from-post': {
    undecided: 'ENG-CLAIRE-META-ADS',
  },
  'POST /meta-ads/import': {
    notExposed:
      "Bulk-imports every ad from the connected Meta ad account into local rows, including ads built outside this product. A long, rate-limited reconciliation whose only visible effect is that lists change shape afterwards, and re-running it opportunistically eats the account's Graph API budget.",
  },
  'POST /meta-ads/:id/sync': {
    notExposed:
      "Pulls one ad's delivery status back from Meta. Status is already refreshed by the scheduled sync and returned in the listing Claire reads, so an on-demand pull only adds a Graph API call and a chance to quote a number that changes a second later.",
  },
  'POST /meta-ads/webhook': {
    notExposed:
      "Meta's server-to-server delivery endpoint for ad status changes. Unauthenticated by design and validated by signature; it is something Meta calls, never something an assistant calls.",
  },
});
