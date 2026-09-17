import { defineCoverage } from '../coverage.types.js';

/**
 * RECOMMENDATIONS — 1 endpoint, 0 tools. A single org-scoped read that rolls
 * recent performance into the "what should I do next" cards the dashboard
 * renders (windowed by `days`, capped by `limit`).
 *
 * This is a read, it is cheap, it is bounded, and it is the exact question
 * owners open Claire to ask. By the GET default it should be exposed — there is
 * simply no tool yet. Recording that as `undecided` rather than `notExposed`
 * keeps it visible as a build candidate instead of pretending it was a
 * deliberate exclusion.
 */
export const recommendationsCoverage = defineCoverage('recommendations', {
  'GET /recommendations': { undecided: 'ENG-CLAIRE-RECOMMENDATIONS' },
});
