import { defineCoverage } from '../coverage.types.js';

/**
 * WAGE-CONFIGS — 2 endpoints, 0 tools. One row per practitioner: their hourly
 * rate, salary and commission terms. Together with `time-entries` it is the
 * complete payroll input — hours from one, rate from the other.
 *
 * Both are refused, including the read. This is the clearest instance in the
 * batch of the reason the GET default exists to be overridden: an individual
 * colleague's pay is the most sensitive record in the product, it answers
 * nothing Claire is ever asked, and surfacing it into a transcript is a
 * disclosure that cannot be taken back.
 */
export const wageConfigsCoverage = defineCoverage('wage-configs', {
  // ---- reads -------------------------------------------------------------
  'GET /wage-configs/:practitionerId': {
    notExposed:
      'An individual colleague’s pay — hourly rate, salary, commission. The most sensitive personal record in the product, it answers no question Claire is asked, and once it is in a transcript the disclosure cannot be undone.',
  },

  // ---- writes ------------------------------------------------------------
  'PUT /wage-configs/:practitionerId': {
    notExposed:
      'Sets what a named employee is paid. Changing someone’s compensation is a contractual act between employer and employee, with an accountable human on both sides of it.',
  },
});
