import { appointment } from '@borradh-workspace/database';
import { activeAppointmentStatuses } from '@borradh-workspace/labels';
import { and, eq, gt, inArray, lt, ne, or } from 'drizzle-orm';
import { type DbConnection, notDeleted } from '../../shared/index.js';

interface CheckOverlapInput {
  startDate: Date;
  endDate: Date;
  /**
   * Who OWNS the record. Optional, because it is not always the right subject
   * to check: on a staff-side booking `assignedToId` is defaulted to whoever
   * is logged in, so two unrelated clients booked by the same receptionist
   * into two different chairs would "clash" on it. Callers that mean
   * "the same practitioner cannot be in two places at once" pass only
   * `practitionerId` (ENG-792).
   */
  assignedToId?: string;
  organizationId: string;
  // When the appointment is tied to a practitioner, a clash on the SAME
  // practitioner is also a conflict — even if the assignee differs. A
  // practitioner cannot be in two places at once.
  practitionerId?: string;
  excludeId?: string;
}

interface OverlapResult {
  hasConflict: boolean;
  conflictingAppointment?: {
    id: string;
    title: string;
    startDate: Date;
    endDate: Date;
    /**
     * The BRANCH the clashing appointment sits at, so the caller can say which
     * one. Null on a row that predates the location backfill.
     *
     * This check is deliberately org-wide (a practitioner cannot be in two
     * cities at once), which means the clash it reports is very often NOT
     * visible on the calendar the user is looking at. Without naming the
     * branch, "this time is already booked" points at an empty slot and reads
     * as a bug — so the natural response is to click through the warning and
     * double-book someone across two sites.
     */
    locationId: string | null;
  };
}

/**
 * Check if there is an overlapping scheduled appointment for the same assignee
 * OR the same practitioner. Two intervals [A.start, A.end) and [B.start, B.end)
 * overlap when:
 *   A.start < B.end AND A.end > B.start
 */
export async function hasOverlappingAppointment(
  db: DbConnection,
  input: CheckOverlapInput
): Promise<OverlapResult> {
  // Clash if the slot collides for any subject the caller named: the same
  // assignee, the same practitioner, or either.
  const subjects = [
    input.assignedToId
      ? eq(appointment.assignedToId, input.assignedToId)
      : undefined,
    input.practitionerId
      ? eq(appointment.practitionerId, input.practitionerId)
      : undefined,
  ].filter((clause): clause is Exclude<typeof clause, undefined> => !!clause);

  // No subject means there is nobody to double-book — an unassigned booking
  // with no practitioner blocks nothing and collides with nothing. Answering
  // "no conflict" is correct here; ANDing zero clauses would instead match
  // every appointment in the org.
  if (subjects.length === 0) return { hasConflict: false };

  const subjectMatch = subjects.length === 1 ? subjects[0] : or(...subjects);

  const conditions = [
    subjectMatch,
    eq(appointment.organizationId, input.organizationId),
    inArray(appointment.status, [...activeAppointmentStatuses]),
    notDeleted(appointment),
    lt(appointment.startDate, input.endDate),
    gt(appointment.endDate, input.startDate),
  ];

  if (input.excludeId) {
    conditions.push(ne(appointment.id, input.excludeId));
  }

  const conflict = await db.query.appointment.findFirst({
    where: and(...conditions),
    columns: {
      id: true,
      title: true,
      startDate: true,
      endDate: true,
      locationId: true,
    },
  });

  if (!conflict) {
    return { hasConflict: false };
  }

  return {
    hasConflict: true,
    conflictingAppointment: {
      id: conflict.id,
      title: conflict.title,
      startDate: conflict.startDate,
      endDate: conflict.endDate,
      locationId: conflict.locationId ?? null,
    },
  };
}
