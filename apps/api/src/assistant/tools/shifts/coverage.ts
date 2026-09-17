import { defineCoverage } from '../coverage.types.js';

/**
 * SHIFTS — 4 endpoints, 0 tools.
 *
 * This is the gap worth looking at first, and the reason this gate grades reads
 * at all. Shifts are the SOLE availability source: no shift rows means a
 * service is unbookable. So when an owner asks "why can't customers book?",
 * Claire currently cannot answer — not because a write is missing, but because
 * she cannot READ the rota. `GET /shifts` is one endpoint and would turn a
 * dead end into a diagnosis.
 *
 * Gate 1 scored this area 3 uncovered endpoints. It was 4 — Gate 1 never
 * counted the read.
 *
 * The READ is now closed: `shifts_explainAvailability` composes this endpoint
 * with opening hours, blocked time and time off into an answer to "why can't
 * customers book?". The three writes remain undecided — a rota change moves
 * every downstream booking slot, so exposing them needs a confirm story.
 */
export const shiftsCoverage = defineCoverage('shifts', {
  // Read the rota — now reachable, via `shifts_explainAvailability`, which
  // composes this with opening hours, blocked time and time off into an answer
  // to "why can't customers book?" rather than four raw dumps.
  'GET /shifts': { exposed: 'shifts_explainAvailability' },

  // Writes. A rota change moves every downstream booking slot, so if these are
  // exposed they will want `confirm: true` — the gate will refuse an `exposed`
  // that does not say.
  'PUT /shifts/weekly/:practitionerId': {
    undecided: 'ENG-CLAIRE-SHIFTS-WRITE',
  },
  'PUT /shifts/override/:practitionerId': {
    undecided: 'ENG-CLAIRE-SHIFTS-WRITE',
  },
  'DELETE /shifts/override/:practitionerId/:date': {
    undecided: 'ENG-CLAIRE-SHIFTS-WRITE',
  },
});
