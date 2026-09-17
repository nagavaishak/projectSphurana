import { defineCoverage } from '../coverage.types.js';

/**
 * MEMBERSHIP-PLANS — 5 endpoints, 0 tools. The recurring-revenue products an
 * org sells: a plan with a price, a billing interval, and the entitlements a
 * subscriber gets. `lead-memberships` holds the subscriptions taken out
 * against them.
 *
 * The reads matter more here than the endpoint count suggests. Claire already
 * sells — `offers_suggestIntroOffer`, `claire_publishOffer`,
 * `context_listServices` — and a membership is often the right answer to
 * "how do I get this customer back more often?". Not being able to name the
 * org's own plans is a live gap, so both reads are parked as `undecided`. The
 * writes are refused: a plan defines a recurring charge against a customer's
 * card, and editing one changes what existing subscribers pay.
 */
export const membershipPlansCoverage = defineCoverage('membership-plans', {
  // ---- reads -------------------------------------------------------------
  // Read through the catalog port, alongside services and packages. The list
  // projection already carries the covered service ids, which is what makes
  // "does the membership cover a facial?" answerable.
  'GET /membership-plans': { exposed: 'packages_listSellables' },
  'GET /membership-plans/:id': { undecided: 'ENG-CLAIRE-MEMBERSHIP-PLANS' },

  // ---- writes ------------------------------------------------------------
  'POST /membership-plans': {
    notExposed:
      'Defines a recurring charge — price, interval and entitlements — that customers will be billed against indefinitely. Pricing a subscription product is the owner’s commercial call, not a suggestion to be enacted.',
  },
  'PUT /membership-plans/:id': {
    notExposed:
      'Edits a plan that people may already be subscribed to, changing what existing members pay or receive. That is a change to live contracts with customers.',
  },
  // The ADD half of branch assignment. None of the PUT's mechanical hazard
  // applies here — it only inserts, rejects an empty list, and no-ops on a plan
  // already sold everywhere. Withheld anyway, for a plainer reason: Claire has
  // one read in this whole area and no way to create or price a plan, so a
  // lone write to move one between branches would be a capability with no
  // context around it. Expose it when the area gets a real plan surface.
  'DELETE /membership-plans/:id/locations/:locationId': {
    notExposed:
      'Stops selling a plan at one branch. Withheld for the same reasons as the POST beside it, plus one of its own: removal narrows what a customer can buy, and against a plan sold everywhere it writes the complement rather than deleting a row.',
  },

  'POST /membership-plans/:id/locations': {
    notExposed:
      'Adds branches that sell a plan. Safe in shape (additive, no empty-set inversion, no-ops on a plan sold everywhere) — withheld because this area exposes a single read and no plan authoring at all, so branch assignment would be the only write Claire could make here and she would be reasoning about a catalogue she cannot otherwise see. `POST /organization-services/:id/locations` IS exposed, because services are the one area with full CRUD behind it.',
  },
  'PUT /membership-plans/:id/locations': {
    notExposed:
      'Replaces which branches sell this plan. Same mechanical hazard as `PUT /organization-services/:id/locations`: a full replace whose EMPTY body means "sold at every branch", so "stop selling it in Cork" read as "clear the list" does the opposite. No price override on this table, so only half the hazard applies — but the inverted empty set is the whole of it.',
  },
  'DELETE /membership-plans/:id': {
    notExposed:
      'Removes a plan that active subscriptions and past billing records point at. Destructive to the revenue trail and reversible only from a backup.',
  },
});
