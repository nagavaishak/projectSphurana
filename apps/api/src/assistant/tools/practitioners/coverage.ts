import { defineCoverage } from '../coverage.types.js';

/**
 * PRACTITIONERS — 13 endpoints, 1 tool. The staff roster, and the join tables
 * that decide who can perform which service at which location. It is the
 * quietest dependency in the booking stack: `appointments_findOpenSlots` and
 * `appointments_bookAppointment` both resolve a practitioner, and Claire
 * previously reached one only as an id that came back inside an appointment.
 *
 * The two facts she most obviously lacked — a staff list and a
 * who-does-this-service lookup — are now one tool, `practitioners_listTeam`,
 * because they are the same read at two grains. `GET /practitioners/:id` stays
 * `undecided`: the list answers it by name, and a third path to the same fact
 * is a selection ambiguity, not a capability. The writes are
 * governed by `@RequireRole('owner'|'admin')` on the controller, which is the
 * codebase saying out loud that roster changes are a privileged human act; the
 * two assignment PUTs additionally replace the whole set rather than amend it,
 * so a partial payload silently unassigns everything omitted.
 */
export const practitionersCoverage = defineCoverage('practitioners', {
  // ---- reads -------------------------------------------------------------
  'GET /practitioners': { exposed: 'practitioners_listTeam' },
  'GET /practitioners/:id': { undecided: 'ENG-CLAIRE-PRACTITIONERS' },
  'GET /practitioners/for-service/:serviceId': {
    exposed: 'practitioners_listTeam',
  },
  'GET /practitioners/me': {
    notExposed:
      'Resolves the logged-in user to their own practitioner row — session plumbing the staff app uses to know whose rota to render. Claire acts for the organisation, not as a device’s signed-in user, so the answer is meaningless to her.',
  },

  // ---- writes ------------------------------------------------------------
  'POST /practitioners': {
    notExposed:
      'Owner-only. Adding a person to the roster makes them bookable and starts costing wages; the owner does it once, from the team screen, with the person’s details in front of them.',
  },
  'POST /practitioners/team-member': {
    notExposed:
      'Admin-only, and it sends a real invitation email to a real person. Claire dispatching staff invitations off her own reasoning is an outbound message the owner never approved.',
  },
  'POST /practitioners/:id/invite': {
    notExposed:
      'Admin-only, and it is nothing BUT an outbound email to a real person — the same objection as `team-member`, without even the roster change to justify it. A re-send also reads as pestering when it lands twice, and Claire cannot know whether the owner has already spoken to them.',
  },
  'PUT /practitioners/:id': {
    notExposed:
      'Admin-only edit of a named colleague’s profile — job title, bio, working details. It is another person’s record, not the org’s marketing copy, so it stays with a human who can ask them.',
  },
  'DELETE /practitioners/:id': {
    notExposed:
      'Owner-only removal of a staff member, which detaches them from their appointment and timesheet history. Reversible only from a backup.',
  },
  'PUT /practitioners/:id/services': {
    notExposed:
      'Replaces the practitioner’s entire service list rather than amending it, so any id Claire failed to include is silently unassigned — quietly making a member of staff unbookable for work they actually do.',
  },
  // The ADD half. The PUT's hazard — a dropped id removing someone from a
  // branch's calendar — is structurally impossible here: it only inserts.
  // Still withheld, because the decision is about PEOPLE and their working
  // week, and the org's admin is the one who knows whether someone can
  // actually be in Cork on a Tuesday. Claire has no view of that.
  'POST /practitioners/:id/locations': {
    notExposed:
      'Adds branches a practitioner works at. Additive, so it cannot remove anyone from a calendar the way the PUT can — withheld on judgement rather than mechanics: where a person works is a staffing decision made with knowledge (contracts, travel, childcare) that exists nowhere in this system, and getting it wrong publishes someone as bookable at a branch they cannot reach.',
  },

  'PUT /practitioners/:id/locations': {
    notExposed:
      'Same replace-the-whole-set shape as the services assignment, and location assignment is what makes a practitioner appear in a branch’s availability at all. A dropped id removes them from the calendar.',
  },
  'POST /practitioners/link-me': {
    notExposed:
      'Self-service plumbing: matches the signed-in user to an existing practitioner row by their own email during staff onboarding. Only the account holder can perform it for themselves.',
  },
  'POST /practitioners/:id/complete-profile-setup': {
    notExposed:
      'Marks a practitioner’s own onboarding checklist as finished. It attests that a person completed their setup, which Claire is in no position to attest to.',
  },
});
