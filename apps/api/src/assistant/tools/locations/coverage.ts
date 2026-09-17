import { defineCoverage } from '../coverage.types.js';

/**
 * LOCATIONS (opening hours) — 4 endpoints, 0 tools. When the doors are open:
 * a standing weekly pattern per location, plus dated exceptions for bank
 * holidays, early closes and one-off shutdowns.
 *
 * `GET /locations/:locationId/opening-hours` is the second half of the
 * availability answer, and it belongs with `GET /shifts` on the same short
 * list. Shifts say which staff are rota'd; opening hours say whether the
 * building is open at all. Between them they explain nearly every "why can't
 * customers book that day?" an owner will ever ask, and Claire can read
 * neither — she can enumerate open slots via `appointments_findOpenSlots` but
 * cannot see the rule that produced them, so an empty result is a dead end
 * rather than a diagnosis.
 *
 * On the writes: closing for a bank holiday is a genuinely conversational
 * request and is parked for a decision. Rewriting the standing week is not.
 */
export const locationsCoverage = defineCoverage('locations', {
  // ---- reads -------------------------------------------------------------
  // Returns the EFFECTIVE schedule over a window — standing hours with
  // exceptions already folded in. Exactly the shape a diagnosis needs.
  // Read by `shifts_explainAvailability`, which composes the four availability
  // sources into one answer. Exposed here rather than as its own tool: a raw
  // dump of this list does not tell an owner why a slot is missing.
  'GET /locations/:locationId/opening-hours': {
    exposed: 'shifts_explainAvailability',
  },

  // ---- writes ------------------------------------------------------------
  // "We're closed Monday the 5th" / "we're open again after all" are ordinary
  // things an owner says out loud. Both would want `confirm: true`: an
  // exception instantly makes a day unbookable, or bookable again.
  'PUT /locations/:locationId/opening-hours/exceptions/:date': {
    undecided: 'ENG-CLAIRE-OPENING-HOURS-WRITE',
  },
  'DELETE /locations/:locationId/opening-hours/exceptions/:date': {
    undecided: 'ENG-CLAIRE-OPENING-HOURS-WRITE',
  },

  'PUT /locations/:locationId/opening-hours/standing': {
    notExposed:
      'Replaces the entire weekly opening pattern in one payload — every day, open and closed alike. Changing Thursday means restating all seven days, so a partial reconstruction silently closes the days it forgot, and every bookable slot in the product is derived from this row. The settings screen shows the whole week at once for exactly that reason.',
  },
});
