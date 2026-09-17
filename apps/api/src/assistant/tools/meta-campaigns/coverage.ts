import { defineCoverage } from '../coverage.types.js';

/**
 * META-CAMPAIGNS — 12 endpoints. The container an ad lives in: objective,
 * budget, targeting, schedule. Its tools sit in `tools/ads/` and are named
 * `meta_ads_*`, because the owner-facing noun is "the ad" and the campaign is
 * plumbing underneath it — which is why several tool names here read as ad
 * tools while the route they call is a campaign route.
 *
 * Budget is the thing that spends, so it gets its own confirm/execute pair
 * (`meta_ads_confirmUpdateBudget` / `meta_ads_executeUpdateBudget`), separate
 * from the plain edit tool. Note the consequence for `PUT
 * /meta-campaigns/:metaCampaignId`: TWO paths reach it with different postures.
 * `meta_ads_updateCampaign` writes name and targeting unconfirmed and refuses
 * budget by construction; the budget pair confirms. The endpoint is declared
 * under the unconfirmed tool because that is the one a model reaches for by
 * default, and the entry should describe the weaker guarantee, not the stronger.
 *
 * Pausing is confirmed and resuming is not exposed at all — asymmetric on
 * purpose. Stopping spend on a stale view costs an owner nothing they cannot
 * undo; restarting it does.
 *
 * `POST /meta-campaigns/sync-all` is the one entry with an incident behind it:
 * it held a pooled database connection open across a long chain of Meta API
 * calls and saturated the pool in production.
 */
export const metaCampaignsCoverage = defineCoverage('meta-campaigns', {
  // ---- reads -------------------------------------------------------------
  'GET /meta-campaigns': { exposed: 'meta_ads_listCampaigns' },
  'GET /meta-campaigns/:metaCampaignId/insights': {
    exposed: 'meta_ads_getCampaignInsights',
  },
  'GET /meta-campaigns/:metaCampaignId/diagnose': {
    exposed: 'meta_ads_diagnoseCampaign',
  },

  'GET /meta-campaigns/insights': {
    undecided: 'ENG-CLAIRE-META-CAMPAIGNS',
  },
  'GET /meta-campaigns/:metaCampaignId/learning-status': {
    undecided: 'ENG-CLAIRE-META-CAMPAIGNS',
  },

  // ---- writes ------------------------------------------------------------
  'POST /meta-campaigns': {
    exposed: 'meta_ads_createCampaign',
    confirm: false,
  },
  'PUT /meta-campaigns/:metaCampaignId': {
    exposed: 'meta_ads_updateCampaign',
    confirm: false,
  },
  'POST /meta-campaigns/:metaCampaignId/duplicate': {
    exposed: 'meta_ads_duplicateCampaign',
    confirm: false,
  },
  'POST /meta-campaigns/:metaCampaignId/pause': {
    exposed: 'meta_ads_executePauseAd',
    confirm: true,
  },

  // Confirmed, like pause. Pause is the SAFE direction — it stops money
  // leaving — so gating that and not this would be exactly backwards.
  'POST /meta-campaigns/:metaCampaignId/resume': {
    exposed: 'meta_ads_executeResumeAd',
    confirm: true,
  },
  'POST /meta-campaigns/sync-all': {
    notExposed:
      'Reconciles every campaign in the account against Meta in one pass. It held a pooled database connection open across the whole chain of Graph API calls and saturated the connection pool in production, which is why it now runs on a dedicated worker rather than on request. Nothing conversational should be able to trigger it.',
  },
  'DELETE /meta-campaigns/:metaCampaignId': {
    notExposed:
      'Deletes the campaign and takes its spend and performance history with it — the org\'s record of what its ad money bought. Pausing achieves everything an owner means by "stop this", reversibly, and that is already reachable.',
  },
});
