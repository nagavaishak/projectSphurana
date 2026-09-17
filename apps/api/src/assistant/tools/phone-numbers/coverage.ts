import { defineCoverage } from '../coverage.types.js';

/**
 * PHONE-NUMBERS — 5 endpoints, 0 tools. Telnyx number provisioning: search the
 * carrier catalogue, lease a number, register one you already own, release one.
 * The leased number is what SMS campaigns send from.
 *
 * Every write here is `AdminGuard`-gated and spends or destroys a telco
 * resource, which puts them well past the "writes lean not exposed" default —
 * these are recurring charges and irreversible releases, and the number is a
 * shared identity the business publishes. Even the search read is out: it
 * returns a purchasable catalogue whose only use is feeding the buy call, so
 * exposing it hands Claire half a transaction she must not finish.
 *
 * The list of numbers the org already holds is the one benign read.
 */
export const phoneNumbersCoverage = defineCoverage('phone-numbers', {
  'GET /phone-numbers': { undecided: 'ENG-CLAIRE-PHONE-NUMBERS' },

  'GET /phone-numbers/available': {
    notExposed:
      'Live Telnyx inventory search. The results are only meaningful as input to the admin-gated buy call, so exposing the read hands Claire the first half of a purchase she is deliberately barred from completing.',
  },
  'POST /phone-numbers/buy': {
    notExposed:
      'Leases a number from the carrier — a real purchase with a recurring monthly charge, admin-gated for that reason. Spending money is the canonical never-without-a-human write.',
  },
  'POST /phone-numbers': {
    notExposed:
      'Registers an externally-owned number against the org, which requires provider credentials and carrier verification Claire has no way to supply or check. A wrong entry silently misroutes every campaign reply.',
  },
  'DELETE /phone-numbers/:id': {
    notExposed:
      'Releases the number back to the carrier permanently — it cannot be reclaimed, and every campaign, reply thread and printed card bound to it breaks at once.',
  },
});
