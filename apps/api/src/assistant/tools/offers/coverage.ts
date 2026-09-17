import { defineCoverage } from '../coverage.types.js';

/**
 * OFFERS — 6 endpoints, 6 tools (plus the two Claire-draft tools). Discounts,
 * intro prices and bundles. Small, and covered end to end, because an offer is
 * the single most conversational object in the product: "what should I run this
 * month?" is the question the assistant exists to answer.
 *
 * Two things make the write decisions here unusual.
 *
 * First, an offer is CUSTOMER-FACING the moment it goes active — it appears in
 * booking, it is quoted in ads, and shortening or ending one can strand a
 * customer mid-decision. So every state change is `destructive: true`:
 * `offers_expireOffer` and `offers_extendOffer` both drive `PUT /offers/:id`
 * and both ask first, which is why that endpoint is `confirm: true` even though
 * it is nominally just an edit.
 *
 * Second, `POST /offers` runs UNCONFIRMED and that is deliberate: the offer is
 * created in `draft` state and publishes nothing. The confirmation sits at
 * promotion (`claire_publishOffer`, rendered as an OfferPublishConfirmation
 * card the owner clicks) — the same shape as the ad flow. Confirming the draft
 * as well would put two prompts in front of one decision.
 */
export const offersCoverage = defineCoverage('offers', {
  // ---- reads -------------------------------------------------------------
  'GET /offers': { exposed: 'context_listOffers' },
  'GET /offers/:id': { exposed: 'offers_getOfferPerformance' },

  // ---- writes ------------------------------------------------------------
  'POST /offers': { exposed: 'offers_createOffer', confirm: false },
  'PUT /offers/:id': { exposed: 'offers_expireOffer', confirm: true },
  'POST /offers/:id/promote-draft': {
    exposed: 'claire_publishOffer',
    confirm: true,
  },

  'DELETE /offers/:id': {
    notExposed:
      'Deleting an offer destroys its redemption history, which is the org\'s record of what a customer was actually promised at the till. Ending an offer is what an owner means when they say "get rid of it", and offers_expireOffer does that reversibly.',
  },
  'DELETE /offers/:id/locations/:locationId': {
    notExposed:
      'Stops running a promotion at one branch. Ending a discount early is a commercial decision with customers already holding the expectation; `offers_expireOffer` is the reversible, org-wide way Claire ends one.',
  },

  'POST /offers/:id/locations': {
    notExposed:
      "Adds branches a promotion runs at. Additive and safe in shape, and this IS an area Claire authors in — but she sets an offer's branches at creation through `offers_createOffer`, so a second path that widens an already-published discount to another branch adds reach without adding capability. The person who published the promotion decides where else it runs.",
  },
});
