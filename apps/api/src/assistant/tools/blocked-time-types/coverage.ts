import { defineCoverage } from '../coverage.types.js';

/**
 * BLOCKED-TIME-TYPES — 4 endpoints, 0 tools. The small settings-level taxonomy
 * behind blocked time: the labelled, colour-coded reasons ("Lunch", "Training",
 * "Admin") that populate the picker when someone blocks a slot out.
 *
 * This is a taxonomy, not a capability. It is written once during setup and
 * read thousands of times, so the read and the writes point in opposite
 * directions: the list is worth Claire having if she is ever to describe or
 * create a block, and adding to it from a conversation is worth almost nothing
 * while costing everyone a cluttered dropdown.
 */
export const blockedTimeTypesCoverage = defineCoverage('blocked-time-types', {
  // ---- reads -------------------------------------------------------------
  // Needed to render "blocked for Training" rather than a bare type id, and a
  // prerequisite for any future blocked-time write tool.
  'GET /blocked-time-types': { undecided: 'ENG-CLAIRE-BLOCKED-TIME-READ' },

  // ---- writes ------------------------------------------------------------
  'POST /blocked-time-types': {
    notExposed:
      'Adds an entry to an org-wide settings taxonomy that every staff member sees in the calendar picker forever after. The set is deliberately tiny and near-static; a model inventing "Lunch Break" beside the existing "Lunch" degrades the dropdown for the whole team in exchange for nothing.',
  },
  'PUT /blocked-time-types/:id': {
    notExposed:
      'Renames or recolours a type that is already attached to existing blocks across everyone’s calendars, so the change reaches back through history. It is a settings-screen edit with no conversational trigger worth the reach.',
  },
  'DELETE /blocked-time-types/:id': {
    notExposed:
      'Removes a reason code that existing blocked-time rows reference. Destructive against records Claire never saw, for a taxonomy she has no reason to prune.',
  },
});
