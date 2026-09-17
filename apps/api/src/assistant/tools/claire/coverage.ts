import { defineCoverage } from '../coverage.types.js';

/**
 * CLAIRE — 9 endpoints, 2 tools. The `/claire` ROUTES are the business-profile
 * classifier and the recommendation feed: they decide what kind of business
 * this is (price tier, clinical-vs-cosmetic, and the other axes), and they hold
 * the recommendation cards the dashboard renders.
 *
 * NOTE ON NAMING. This directory's own `claire_*` tools — `setPendingAdBudget`,
 * `saveOfferDraft`, `publishAd` and friends — are DRAFT-STATE tools for the
 * ad/offer composer. They are not the `/claire` routes and they cover none of
 * the endpoints below; the overlap is a name collision, not coverage.
 *
 * The shape of the decision: the two READS describe what Claire reasons from,
 * and the classifier read is already behind a tool. The writes split into
 * (a) global-admin cross-tenant operations, which an org-scoped assistant must
 * never reach, and (b) endpoints that record the OWNER'S OWN position — their
 * axis override, their market positioning, their verdict on a recommendation.
 * Claire writing those launders her opinion as the owner's, and then reads it
 * back on the next turn as if it were their input. The one exception is
 * `resolve-disagreement`, which exists precisely to capture an answer Claire
 * just asked for out loud, and has a tool for that reason.
 */
export const claireCoverage = defineCoverage('claire', {
  // ---- reads -------------------------------------------------------------
  'GET /claire/ad-creation-context': {
    exposed: 'claire_recommendServiceForAds',
  },
  'GET /claire/recommendations': {
    undecided: 'ENG-CLAIRE-CLAIRE',
  },

  // ---- writes ------------------------------------------------------------
  'POST /claire/business-profile/resolve-disagreement': {
    exposed: 'claire_resolveDisagreement',
    confirm: false,
  },

  'POST /claire/business-profile/classify': {
    notExposed:
      'Blocks the request for a 10-40s LLM classify call. Onboarding and the manual refresh button already trigger it, and re-running it mid-turn can flip the profile axes underneath the recommendation Claire gave two sentences earlier.',
  },
  'POST /claire/business-profile/override-axes': {
    notExposed:
      'Records the OWNER overriding the classifier. The whole value of an override is that a human disagreed; Claire writing it turns her own guess into their stated position, and the disagreement-detection logic then treats it as ground truth.',
  },
  'POST /claire/business-profile/set-market-position': {
    notExposed:
      "Same shape as override-axes — it stores the owner's declared positioning (budget / mid / premium), which drives pricing language in every generated ad. That is a claim only the owner can make about their own business.",
  },
  'POST /claire/admin/business-profile/backfill-all': {
    notExposed:
      'Global-admin batch that reclassifies every organization on the platform. An org-scoped assistant reaching a cross-tenant operation is a tenancy break regardless of how idempotent the operation is.',
  },
  'POST /claire/recommendations/:id/action': {
    notExposed:
      "Marks a recommendation as actioned. Claire ticking off her own suggestion removes it from the owner's feed without the owner having done anything — the card disappears and the work does not happen.",
  },
  'POST /claire/recommendations/:id/dismiss': {
    notExposed:
      "Dismisses a recommendation so it stops being surfaced. Suppressing advice on the owner's behalf is the failure mode the feed exists to prevent, and dismissal is not reversible from the UI.",
  },
});
