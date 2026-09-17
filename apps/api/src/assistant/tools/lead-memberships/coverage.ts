import { defineCoverage } from '../coverage.types.js';

/**
 * LEAD-MEMBERSHIPS — 2 endpoints, 0 tools. The subscriptions themselves: which
 * client is on which plan, since when, and whether it is still active. The
 * plans they point at live in `membership-plans`.
 *
 * The read is a straightforward retention fact about clients Claire already
 * works with through `leads_*` — knowing a lead is a paying member changes what
 * she should say to them — so it is parked as `undecided`. The cancel is
 * refused: it ends a recurring revenue stream and a customer's entitlement in
 * one call, and it is exactly the kind of concession an assistant under
 * conversational pressure would reach for.
 */
export const leadMembershipsCoverage = defineCoverage('lead-memberships', {
  // ---- reads -------------------------------------------------------------
  'GET /lead-memberships': { undecided: 'ENG-CLAIRE-LEAD-MEMBERSHIPS' },

  // ---- writes ------------------------------------------------------------
  'POST /lead-memberships/:id/cancel': {
    notExposed:
      'Ends a paying customer’s subscription — recurring revenue stopped and their entitlements withdrawn. It is the concession a model under pressure from an unhappy customer would reach for first, and it is the owner’s to give.',
  },
});
