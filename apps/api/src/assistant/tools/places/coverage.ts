import { defineCoverage } from '../coverage.types.js';

/**
 * PLACES — 2 endpoints, 0 tools. A thin authenticated proxy in front of Google
 * Places, existing solely so the address field in the location form can offer a
 * typeahead and then resolve the chosen suggestion into a structured address.
 *
 * Both are GETs, and both are `notExposed` — the rare case where the read
 * default does not apply, because these are not a capability at all. They are
 * the two halves of one widget: a keystroke-driven search and its follow-up
 * lookup, correlated by a `sessionToken` the widget mints and Google bills
 * against. Nothing downstream of them is reachable by Claire either — every
 * write in `organization-locations` that would consume a resolved address is
 * itself out of her reach, so exposing the lookup would buy an address with
 * nowhere to put it.
 */
export const placesCoverage = defineCoverage('places', {
  'GET /places/autocomplete': {
    notExposed:
      'Per-keystroke address typeahead proxied to Google Places and billed per request against a session token the form widget mints. It is the first half of a UI interaction, not a question about the business, and the only route that would consume its output — creating or editing a location — is deliberately not Claire’s.',
  },
  'GET /places/details': {
    notExposed:
      'The second half of the same widget: turns a `placeId` from the typeahead into a structured address. The id is only obtainable from an autocomplete call Claire does not make, so on its own the route is unreachable rather than merely unused.',
  },
});
