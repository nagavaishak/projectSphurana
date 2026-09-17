import { defineCoverage } from '../coverage.types.js';

/**
 * APPOINTMENTS — 6 endpoints, 8 tools. The densest tool-per-endpoint ratio in
 * the codebase, and the reason is worth stating: `PUT /appointments/:id` is one
 * route but four distinct human intents (reschedule, cancel, mark no-show,
 * progress the day-of lifecycle), each with a different stakes profile. The
 * tools split it deliberately — `setAppointmentStatus` runs unconfirmed because
 * check-in → in-chair → done is reversible front-desk routine, while
 * `cancelAppointment` and `markNoShow` are confirmation-gated because they are
 * customer-affecting and fire notifications.
 *
 * The coverage decision that matters here is the one absence: `DELETE` exists
 * and is not Claire's, because cancelling is a soft state change that keeps the
 * row while deleting loses the trail.
 */
export const appointmentsCoverage = defineCoverage('appointments', {
  // ---- reads -------------------------------------------------------------
  'GET /appointments': { exposed: 'appointments_listAppointments' },

  'GET /appointments/:id': {
    notExposed:
      'No single-appointment read tool exists, and none is needed: `listAppointments` takes a date range and returns the full row with relations, so every appointment id Claire holds is one she just read. A tool that starts from a bare id would only be reachable if she had invented the id.',
  },

  // ---- writes ------------------------------------------------------------
  // `open-slots` is a read wearing a POST — it takes a filter body too large
  // for a query string and mutates nothing, so it runs unconfirmed. It is also
  // the availability read the whole booking flow depends on.
  'POST /appointments/open-slots': {
    exposed: 'appointments_findOpenSlots',
    confirm: false,
  },

  'POST /appointments': {
    exposed: 'appointments_bookAppointment',
    confirm: true,
  },

  // Reschedule is the canonical caller; cancel, mark-no-show and the
  // lifecycle transitions ride the same route with different status payloads.
  'PUT /appointments/:id': {
    exposed: 'appointments_rescheduleAppointment',
    confirm: true,
  },

  // Rooms & equipment. Lives on this controller because it writes an
  // appointment's holds, but the capability belongs to the resources area and
  // is ported there as `ResourcesPort.setAppointmentResource`.
  'PUT /appointments/:id/resources': {
    notExposed:
      "Ported as `ResourcesPort.setAppointmentResource`. Which physical room a booking occupies is decided by whoever can see the room — a device left mid-cycle, a spill, a client who cannot manage the stairs. None of that is in the database, so Claire choosing a room would be guessing about a space she has no information on, and the cost of guessing wrong is a client walked to a room that is occupied. She already has the honest version of this: the availability port reports rooms as a gating source, so she can say a slot is unbookable because nothing is free. Assigning is the front desk's, on the calendar.",
  },

  'DELETE /appointments/:id': {
    notExposed:
      'Hard-deletes the row. Cancelling is the operation Claire actually wants and she has it — `cancelAppointment` sets status to `cancelled`, keeps the record for audit and lets the existing service fire the practitioner notification. A hard delete throws away the history an owner needs for a no-show fee dispute and cannot be undone.',
  },
});
