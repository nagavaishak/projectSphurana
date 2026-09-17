import { defineCoverage } from '../coverage.types.js';

/**
 * BLOCKED-TIME — 4 endpoints, 0 tools. Deliberate holes punched in a
 * practitioner's calendar: lunch, training, a standing Friday admin hour. Rows
 * can recur, and the edit/delete routes therefore carry a `scope` query param
 * (this occurrence / this and following / the whole series).
 *
 * The read completes the availability picture. Shifts say who is rota'd,
 * opening hours say whether the building is open, and blocked time is the third
 * reason a slot the owner expected to see is missing. Claire can currently
 * observe the symptom through `findOpenSlots` and name none of the three
 * causes.
 *
 * The writes turn on that `scope` param, which is the part a language model is
 * least equipped to get right: the same call with a different scope affects one
 * afternoon or twelve months of them, and the response looks identical.
 */
export const blockedTimeCoverage = defineCoverage('blocked-time', {
  // ---- reads -------------------------------------------------------------
  // Read by `shifts_explainAvailability`, which composes the four availability
  // sources into one answer. Exposed here rather than as its own tool: a raw
  // dump of this list does not tell an owner why a slot is missing.
  'GET /blocked-time': { exposed: 'shifts_explainAvailability' },

  // ---- writes ------------------------------------------------------------
  // Blocking an hour off is low-stakes and reversible — it only ever makes the
  // calendar emptier, never double-books anyone. Would want `confirm: true`
  // since it removes bookable slots customers can currently see.
  'POST /blocked-time': { undecided: 'ENG-CLAIRE-BLOCKED-TIME-WRITE' },

  'PUT /blocked-time/:id': {
    notExposed:
      'Editing a recurring block is governed by a `scope` param — this occurrence, this and all following, or the entire series — and the three produce wildly different results from an identical-looking call. The calendar UI makes the user pick scope in a dialog precisely because the choice is not inferable from what was asked.',
  },
  'DELETE /blocked-time/:id': {
    notExposed:
      'Same `scope` semantics, with the destructive half of the consequence: the wrong scope silently deletes a year of recurring blocks instead of one afternoon, and every slot it was protecting becomes bookable immediately. There is no undo and no diff to review.',
  },
});
