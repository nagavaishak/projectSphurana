import { defineCoverage } from '../coverage.types.js';

/**
 * TIME-OFF — 4 endpoints, 0 tools. Staff leave: holiday, sickness, unpaid days.
 * A time-off row takes a practitioner off the rota for its span, which makes it
 * the fourth and last reason a slot an owner expected is not there — alongside
 * shifts, opening hours and blocked time.
 *
 * The read is therefore the same argument as the other three, plus one of its
 * own: "who is off next week?" is a question an owner asks in words far more
 * often than they open the rota screen to check.
 *
 * The writes are HR. Recording leave is an employment record with pay
 * consequences, and — critically — REMOVING one silently republishes a
 * practitioner as bookable while they are on a beach.
 */
export const timeOffCoverage = defineCoverage('time-off', {
  // ---- reads -------------------------------------------------------------
  // Read by `shifts_explainAvailability`, which composes the four availability
  // sources into one answer. Exposed here rather than as its own tool: a raw
  // dump of this list does not tell an owner why a slot is missing.
  'GET /time-off': { exposed: 'shifts_explainAvailability' },

  // ---- writes ------------------------------------------------------------
  // "Sarah's off all next week" is a plausible thing to say to Claire, and
  // booking the leave immediately protects the calendar from double-booking
  // her. If exposed it wants `confirm: true` — it is an employment record.
  'POST /time-off': { undecided: 'ENG-CLAIRE-TIME-OFF-WRITE' },

  'PUT /time-off/:id': {
    notExposed:
      'Amends the dates or type of a recorded absence. Shortening a leave span makes a practitioner bookable again for the days that were trimmed, so a misheard date silently reopens a calendar for someone who is not there — and the row is also the record the owner reasons about for pay.',
  },
  'DELETE /time-off/:id': {
    notExposed:
      'Erases an absence record entirely, instantly restoring the practitioner to the bookable rota for the whole span. It destroys the HR trail and creates the exact failure the record existed to prevent: a customer booked with someone who is away.',
  },
});
