import { defineCoverage } from '../coverage.types.js';

/**
 * TIME-ENTRIES — 7 endpoints, 0 tools. Staff timesheets: clock-in, breaks,
 * clock-out, then a manager approval that makes the entry payable. Together
 * with `wage-configs` this is the payroll input path.
 *
 * This is the one area in the commerce batch where the READ is refused too,
 * and deliberately: a time entry is an attendance record for a named employee,
 * and combined with their wage config it is their pay. That is staff-personal
 * data, one of the stated reasons for keeping a read out of Claire's hands, and
 * it answers no question a marketing assistant is asked. The writes are worse
 * than merely private — clocking a colleague in asserts they were physically at
 * work, and approving an entry authorises money to leave the business.
 */
export const timeEntriesCoverage = defineCoverage('time-entries', {
  // ---- reads -------------------------------------------------------------
  'GET /time-entries': {
    notExposed:
      'Attendance records for named employees, and the direct input to payroll once joined to their wage config. Staff-personal data with no bearing on anything Claire is asked to do.',
  },

  // ---- writes ------------------------------------------------------------
  'POST /time-entries/clock-in': {
    notExposed:
      'Clocking in asserts that a named person is physically at work right now. Only that person, or a manager who can see them, is in a position to make the claim.',
  },
  'POST /time-entries/:id/clock-out': {
    notExposed:
      'Ends a shift and fixes its paid duration. An assistant guessing when someone left either underpays them or pays for hours not worked.',
  },
  'POST /time-entries/:id/breaks': {
    notExposed:
      'Starts or ends an unpaid break, directly changing payable hours and the org’s record of break compliance. It tracks a physical event Claire cannot observe.',
  },
  'PUT /time-entries/:id': {
    notExposed:
      'Manual correction of a recorded shift — the route an employee would dispute. Edits to attendance must trace to an accountable manager, not an assistant.',
  },
  'POST /time-entries/:id/approve': {
    notExposed:
      'Approval is the sign-off that makes the entry payable. It is a person taking responsibility for money leaving the business, which cannot be delegated to a model.',
  },
  'DELETE /time-entries/:id': {
    notExposed:
      'Destroys an attendance record that may be needed for a wage dispute or a working-time audit. Reversible only from a backup.',
  },
});
