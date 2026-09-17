import {
  appointment,
  appointmentService,
  organization,
  organizationLocation,
  practitioner,
  withPatientScope,
  withSystemScope,
} from '@borradh-workspace/database';
import type { AppointmentStatus } from '@borradh-workspace/labels';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  bookingLocationAddressLines,
  isBookingLocationAddressable,
} from '../../../organization-locations/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type ListPatientBookingsInput,
  listPatientBookingsSchema,
} from './list-patient-bookings.schema.js';

/** The branch a booking is at, as the patient portal renders it. */
export interface PatientBookingLocation {
  id: string;
  /** "Dublin Branch". Null on branches nobody named — render the address. */
  name: string | null;
  /**
   * The branch's public slug, or null on a pre-backfill row.
   *
   * Not decoration: it is how the portal points the public slots endpoint at
   * THIS branch when the patient reschedules. See `canReschedule`.
   */
  slug: string | null;
  /** Postal address, one line per part, empty when nothing is on file. */
  addressLines: string[];
}

/** One booking as the patient portal sees it. */
export interface PatientBooking {
  id: string;
  serviceName: string;
  practitionerName: string | null;
  startTime: Date;
  endTime: Date;
  status: AppointmentStatus;
  /**
   * The primary catalog service, when it still exists — the portal needs it to
   * offer a reschedule slot picker. Null means "cannot be moved online".
   */
  serviceId: string | null;
  durationMinutes: number;
  /**
   * The BRANCH this booking is at — the address the patient has to drive to.
   *
   * Null when `appointment.location_id` is NULL (every pre-backfill row) or
   * names a branch that has since been deleted. Null means "we do not know",
   * and the portal must then show NOTHING rather than the org's primary
   * branch: printing Dublin's address on a Cork booking is worse than
   * printing none, because the patient acts on it.
   */
  location: PatientBookingLocation | null;
  /**
   * Whether the portal should offer "Cancel": the clinic allows online
   * cancellations AND the booking is still actionable (booked/confirmed).
   *
   * Deliberately NOT gated on the notice window. A late cancellation is
   * permitted and carries the clinic's stated fee — see
   * `evaluateBookingPolicy`, which is the same gate the mutation enforces.
   * These two must agree, or the portal hides a control the server would have
   * accepted (or offers one it then rejects).
   */
  canCancel: boolean;
  /**
   * Last instant the patient can still cancel FREE OF CHARGE (ISO), i.e.
   * `startDate - cancellationNoticeRequiredHours`. Null when cancellations are
   * disabled or no notice is required (0h) — there is no deadline to show.
   *
   * This is a fee boundary, not a permission boundary: past it the patient may
   * still cancel, and the UI should say the fee now applies.
   */
  cancelDeadline: string | null;
  /**
   * Whether the portal should offer "Reschedule": the clinic allows online
   * rescheduling AND the booking is still actionable. Same reasoning as
   * `canCancel` — the notice window does not gate it.
   */
  canReschedule: boolean;
}

export interface PatientBookingsData {
  /** startTime >= now, soonest first. */
  upcoming: PatientBooking[];
  /** startTime < now, most recent first, capped at 20. */
  past: PatientBooking[];
  /** The clinic's IANA timezone — times are rendered in it, not the browser's. */
  timezone: string;
}

const PAST_LIMIT = 20;

const listPatientBookingsImpl = async (
  db: DbConnection,
  input: ListPatientBookingsInput
): Promise<Result<PatientBookingsData>> => {
  const { leadId, organizationId } = input;

  // ── Patient-scoped read ───────────────────────────────────────────────────
  // The explicit leadId/organizationId filters are defense in depth; with RLS
  // on, the `patient_self` policy already makes any other patient's rows
  // literally invisible on the `app_patient` pool.
  const rows = await withPatientScope(
    { leadId, organizationId },
    (tx) =>
      tx.query.appointment.findMany({
        where: and(
          eq(appointment.leadId, leadId),
          eq(appointment.organizationId, organizationId),
          notDeleted(appointment)
        ),
      }),
    { db }
  );

  // ── System-scoped enrichment ──────────────────────────────────────────────
  // Service/practitioner/org names are NOT patient-owned rows, so they are not
  // visible under `app_patient`. Enrichment is keyed strictly on the ids the
  // patient-scoped read above already proved this patient owns.
  const appointmentIds = rows.map((row) => row.id);
  const practitionerIds = [
    ...new Set(
      rows.flatMap((row) => (row.practitionerId ? [row.practitionerId] : []))
    ),
  ];

  const { org, lineItems, practitioners, locations } = await withSystemScope(
    async (tx) => ({
      org: await tx.query.organization.findFirst({
        where: eq(organization.id, organizationId),
      }),
      // EVERY branch of the org, not just the ones these rows point at.
      // `getBookingLocationById` is the one-row resolver and this is a list —
      // one read beats one per booking. Fetching them all also answers "does
      // this org have more than one branch?", which decides whether an
      // unaddressable branch can be rescheduled online at all (see
      // `canReschedule` below). Orgs have branches in the single digits.
      locations: await tx.query.organizationLocation.findMany({
        where: eq(organizationLocation.organizationId, organizationId),
        orderBy: [
          desc(organizationLocation.isPrimary),
          asc(organizationLocation.sortOrder),
        ],
        columns: {
          id: true,
          name: true,
          slug: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          county: true,
          postalCode: true,
        },
      }),
      lineItems:
        appointmentIds.length > 0
          ? await tx.query.appointmentService.findMany({
              where: inArray(appointmentService.appointmentId, appointmentIds),
            })
          : [],
      practitioners:
        practitionerIds.length > 0
          ? await tx.query.practitioner.findMany({
              where: inArray(practitioner.id, practitionerIds),
            })
          : [],
    }),
    { db }
  );

  const practitionerNameById = new Map(
    practitioners.map((p) => [p.id, p.name])
  );

  const locationById = new Map(
    locations.map((location) => [
      location.id,
      {
        id: location.id,
        name: location.name ?? null,
        slug: location.slug ?? null,
        addressLines: bookingLocationAddressLines(location),
      } satisfies PatientBookingLocation,
    ])
  );
  /**
   * Can the public slots endpoint be pointed at this booking's branch?
   *
   * The endpoint addresses a branch by `slug ?? id`, so "has a slug" is no
   * longer the question — every branch that exists is nameable. Two cases
   * remain:
   *
   *  - the booking names a branch we know → the portal puts it in the URL and
   *    the times offered are that branch's;
   *  - the booking names NO branch (every pre-backfill row) in a MULTI-branch
   *    org → unaddressable. Omitting the segment resolves the org's default
   *    branch, so the portal would show one branch's diary and book into it
   *    without the customer choosing. It offers no online reschedule and says
   *    to contact the clinic instead.
   *
   * A single-branch org is addressable either way: the default IS the branch.
   *
   * The remaining case disappears as `scripts/backfill-location-ids.ts` fills
   * the column. The WRITE gate needs none of this — it keys on `location_id`,
   * which the write path always sets — so a booking that cannot be rescheduled
   * online here can still never be moved to another branch by any route.
   */
  const isBranchAddressable = (locationId: string | null): boolean =>
    isBookingLocationAddressable(
      // An unknown or absent branch on a multi-branch org: we cannot name it,
      // so we must not guess it. A branch we DO know is always nameable now —
      // by slug, or by id when it has no slug yet.
      (locationId ? locationById.get(locationId) : null) ?? null,
      locations.length
    );

  // Snapshot line-item names (survive service rename/delete), in cart order.
  const serviceNamesByAppointment = new Map<string, string[]>();
  for (const item of [...lineItems].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const names = serviceNamesByAppointment.get(item.appointmentId) ?? [];
    names.push(item.name);
    serviceNamesByAppointment.set(item.appointmentId, names);
  }

  // ── Cancellation/rescheduling policy, computed once per row ─────────────
  // `?? true`/`?? 0` mirror the columns' NOT NULL defaults (and cover the
  // degenerate missing-org case, where timezone already falls back below).
  const cancellationsEnabled = org?.customerCancellationsEnabled ?? true;
  const reschedulingEnabled = org?.customerReschedulingEnabled ?? true;
  const cancelNoticeHours = org?.cancellationNoticeRequiredHours ?? 0;
  const now = Date.now();
  const HOUR_MS = 60 * 60 * 1000;
  /** Actionable statuses — everything else is terminal or already in-flight. */
  const isActionable = (status: AppointmentStatus) =>
    status === 'booked' || status === 'confirmed';

  const toBooking = (row: (typeof rows)[number]): PatientBooking => ({
    id: row.id,
    serviceName:
      serviceNamesByAppointment.get(row.id)?.join(' + ') ?? row.title,
    practitionerName: row.practitionerId
      ? (practitionerNameById.get(row.practitionerId) ?? null)
      : null,
    startTime: row.startDate,
    endTime: row.endDate,
    status: row.status,
    serviceId: row.serviceId,
    durationMinutes: Math.round(
      (row.endDate.getTime() - row.startDate.getTime()) / 60_000
    ),
    location: (row.locationId && locationById.get(row.locationId)) || null,
    // The notice window no longer BLOCKS: a late cancel or reschedule is
    // permitted and carries the clinic's stated fee (see
    // evaluateBookingPolicy), because refusing one turns a slot the clinic
    // could still refill into a silent no-show. So these capability flags
    // follow the TOGGLE and the appointment status only — they must agree
    // with the mutation gate, or the portal offers a control the server then
    // rejects.
    canCancel: cancellationsEnabled && isActionable(row.status),
    // Still surfaced, and now more useful: the UI says "free to cancel until
    // <date>", after which the fee applies. That is the whole point of
    // reporting the window instead of enforcing it.
    cancelDeadline:
      cancellationsEnabled && cancelNoticeHours > 0
        ? new Date(
            row.startDate.getTime() - cancelNoticeHours * HOUR_MS
          ).toISOString()
        : null,
    // ...and, unlike cancel, ALSO on the branch being addressable — see
    // `isBranchAddressable`. Offering a picker we would have to fill from
    // another branch's diary is how the reschedule corrupted data in the first
    // place; refusing loudly is the only honest alternative.
    canReschedule:
      reschedulingEnabled &&
      isActionable(row.status) &&
      isBranchAddressable(row.locationId ?? null),
  });
  const upcoming = rows
    .filter((row) => row.startDate.getTime() >= now)
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())
    .map(toBooking);
  const past = rows
    .filter((row) => row.startDate.getTime() < now)
    .sort((a, b) => b.startDate.getTime() - a.startDate.getTime())
    .slice(0, PAST_LIMIT)
    .map(toBooking);

  return ok({ upcoming, past, timezone: org?.timezone ?? 'UTC' });
};

/**
 * The patient's own bookings, split upcoming/past. The appointment read runs
 * under `withPatientScope` (RLS `patient_self`); display-name enrichment runs
 * under system scope keyed on the ids that read returned.
 */
export const listPatientBookings = (
  db: DbConnection,
  input: ListPatientBookingsInput
) =>
  trackedResult(
    'patientBookings.listPatientBookings',
    async () => {
      const parsed = listPatientBookingsSchema.safeParse(input);
      if (!parsed.success) {
        return err(
          new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
            issues: parsed.error.issues,
          })
        );
      }
      try {
        return await listPatientBookingsImpl(db, parsed.data);
      } catch (error) {
        logError('patientBookings.listPatientBookings', error, {
          feature: 'patient-bookings',
          extra: { organizationId: input.organizationId },
        });
        return err(
          new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to load bookings')
        );
      }
    },
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type ListPatientBookingsResult = Awaited<
  ReturnType<typeof listPatientBookings>
>;
