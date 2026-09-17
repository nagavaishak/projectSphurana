import { practitioner } from '@borradh-workspace/database';
import { and, eq, isNull } from 'drizzle-orm';

/**
 * Who a CUSTOMER may be offered — the public booking page, the chatbot, voice.
 *
 * Four conditions, and all four are easy to forget individually, which is
 * exactly why they live here rather than being re-typed at each call site:
 * `is_active` (still employed), `accepts_bookings` (the "Online bookings"
 * toggle in the team-member editor), not soft-deleted, and — since ENG-794 —
 * not sitting on an unaccepted invitation. `accepts_bookings` was for a long
 * time written by the UI and read by nobody, so switching it off did nothing
 * to the booking page.
 */
export const customerBookablePractitioner = () =>
  and(
    eq(practitioner.isActive, true),
    eq(practitioner.acceptsBookings, true),
    eq(practitioner.invitationPending, false),
    isNull(practitioner.deletedAt)
  );

/**
 * In-memory equivalent, for rows already loaded (typically through a join,
 * where the condition above cannot be pushed into the WHERE clause).
 */
export const isCustomerBookable = (row: {
  isActive: boolean;
  acceptsBookings: boolean;
  invitationPending: boolean;
  deletedAt: Date | null;
}): boolean =>
  row.isActive &&
  row.acceptsBookings &&
  !row.invitationPending &&
  row.deletedAt === null;

/**
 * Who STAFF may book a client in with — the calendar's practitioner columns and
 * the create-appointment picker.
 *
 * Deliberately laxer than {@link customerBookablePractitioner}: staff may book
 * outside posted hours (create-appointment runs the availability check for
 * customer-facing sources only), and someone who has switched OFF online
 * bookings can still be booked in by hand and still holds their calendar
 * column. `accepts_bookings` is therefore NOT part of this predicate — it
 * answers "may a CUSTOMER be offered this person", and the team-member editor
 * says so in as many words.
 *
 * Note the one thing staff-side booking is NOT laxer about since ENG-792:
 * OVERLAP. A manual booking used to skip that check too; it no longer does,
 * and a deliberate double-booking now requires explicit consent.
 *
 * What it does share is the invitation gate. An invitee is not a laxer case of
 * a working practitioner — they are a person who may never join. Booking a
 * client in with them produces an appointment nobody has agreed to perform,
 * which is the operational failure ENG-794 reports: two unaccepted invitations
 * were sitting in a clinic's calendar as ordinary practitioner columns, holding
 * seeded 09:00-17:00 rosters.
 */
export const staffBookablePractitioner = () =>
  and(
    eq(practitioner.isActive, true),
    eq(practitioner.invitationPending, false),
    isNull(practitioner.deletedAt)
  );

/** In-memory equivalent of {@link staffBookablePractitioner}. */
export const isStaffBookable = (row: {
  isActive: boolean;
  invitationPending: boolean;
  deletedAt: Date | null;
}): boolean => row.isActive && !row.invitationPending && row.deletedAt === null;
