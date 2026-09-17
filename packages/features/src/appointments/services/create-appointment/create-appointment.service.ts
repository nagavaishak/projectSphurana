import {
  appointment,
  appointmentService,
  lead,
  organization,
  organizationLocation,
  organizationService,
  organizationServiceVariant,
  practitioner,
  withOrgScope,
} from '@borradh-workspace/database';
import type { WorkingHours } from '@borradh-workspace/database';
import { activeAppointmentStatuses } from '@borradh-workspace/labels';
import {
  logError,
  trackOrgEvent,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, eq, inArray } from 'drizzle-orm';
import { createSubmissionsForAppointment } from '../../../consent-forms/index.js';
import { recordLeadConversion } from '../../../leads/index.js';
import { dispatchNotification } from '../../../notifications/services/dispatch-notification/dispatch-notification.service.js';
import { resolveDefaultLocation } from '../../../organization-locations/index.js';
import { resolveAvailability } from '../../../scheduling/services/resolve-availability/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  formatInOrgZone,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { enqueueCalendarSync } from '../../queue/index.js';
import {
  formatConflictRange,
  hasOverlappingAppointment,
} from '../../utils/index.js';
import { notifyPractitionerBooking } from '../notify-practitioner-booking/notify-practitioner-booking.service.js';
import {
  type ResourceWarning,
  allocateAppointmentResources,
  asResourceFeatureError,
} from '../shared/allocate-appointment-resources.js';
import {
  type CreateAppointmentInput,
  createAppointmentSchema,
} from './create-appointment.schema.js';

/** Whether a slot fits entirely inside a working interval and hits no busy one. */
function slotIsBookable(
  start: Date,
  end: Date,
  avail: {
    working: { start: Date; end: Date }[];
    busy: { start: Date; end: Date }[];
  }
): boolean {
  const withinWorking = avail.working.some(
    (w) =>
      w.start.getTime() <= start.getTime() && w.end.getTime() >= end.getTime()
  );
  const hitsBusy = avail.busy.some(
    (b) =>
      b.start.getTime() < end.getTime() && b.end.getTime() > start.getTime()
  );
  return withinWorking && !hitsBusy;
}

/**
 * The appointment row, plus what the booking did with the clinic's rooms.
 *
 * Both extra keys are ADDITIVE — every existing caller reads the appointment
 * fields off the same object and is untouched. An org with no resource
 * requirements always gets `[]` for both.
 */
export type CreatedAppointment = typeof appointment.$inferSelect & {
  /** Rooms/equipment held for this appointment. */
  resources: Array<{ categoryId: string; resourceId: string }>;
  /**
   * Populated only on the MANUAL/console path: the booking was accepted even
   * though a room was already taken. The UI surfaces these as a toast.
   */
  resourceWarnings: ResourceWarning[];
};

/**
 * The branch this appointment will be written to: the caller's explicit choice
 * (server-injected from the validated `X-Location-Id`), else the org's default.
 *
 * Extracted because the CONFLICT MESSAGE needs it too — it names the clashing
 * branch only when that branch differs from this one — and computing it twice
 * would let the message and the row disagree about where the booking is going.
 */
async function resolveTargetLocationId(
  db: DbConnection,
  organizationId: string,
  explicit: string | null
): Promise<string | null> {
  if (explicit) return explicit;
  const defaultLocation = await resolveDefaultLocation(db, organizationId);
  return defaultLocation?.id ?? null;
}

const createAppointmentImpl = async (
  db: DbConnection,
  input: CreateAppointmentInput
): Promise<Result<CreatedAppointment>> => {
  const parsed = createAppointmentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // ── Multi-service cart resolution ─────────────────────────────────────────
  // When a `services` cart is supplied the appointment is still ONE row (keeps
  // the appointment_no_overlap exclusion constraint intact). We derive the two
  // denormalised fields every existing single-service reader depends on:
  //  - endDate: startDate + sum(durationMinutes) when no explicit end was given.
  //  - serviceId (primary): the first cart item's serviceId.
  const rawCartItems = parsed.data.services ?? [];

  // Variant snapshot: for any line naming a `variantId`, resolve the variant
  // (must be active AND belong to that line's service in this org) and snapshot
  // its price/duration/name over the caller-supplied values. There is no
  // `appointment_service.variant_id` column, so only the snapshot persists — a
  // `variant_id` column would be a nice-to-have for reporting/analytics later.
  const requestedVariantIds = rawCartItems
    .map((item) => item.variantId)
    .filter((id): id is string => id !== undefined);
  const variantById = new Map<
    string,
    typeof organizationServiceVariant.$inferSelect
  >();
  if (requestedVariantIds.length > 0) {
    const variantRows = await db
      .select({ variant: organizationServiceVariant })
      .from(organizationServiceVariant)
      .innerJoin(
        organizationService,
        eq(organizationServiceVariant.serviceId, organizationService.id)
      )
      .where(
        and(
          inArray(organizationServiceVariant.id, requestedVariantIds),
          eq(organizationServiceVariant.isActive, true),
          eq(organizationService.organizationId, parsed.data.organizationId)
        )
      );
    for (const row of variantRows) variantById.set(row.variant.id, row.variant);
  }

  const cartItems = rawCartItems.map((item) => {
    const variant = item.variantId
      ? variantById.get(item.variantId)
      : undefined;
    if (!variant) return item;
    return {
      ...item,
      name: `${item.name} — ${variant.name}`,
      durationMinutes: variant.durationMinutes ?? item.durationMinutes,
      priceCents: variant.priceCents ?? item.priceCents ?? null,
    };
  });
  const hasCart = cartItems.length > 0;

  const endDate =
    parsed.data.endDate ??
    new Date(
      parsed.data.startDate.getTime() +
        cartItems.reduce((sum, item) => sum + item.durationMinutes, 0) * 60_000
    );

  const primaryServiceId = hasCart
    ? (cartItems[0].serviceId ?? null)
    : (parsed.data.serviceId ?? null);

  // Verify lead exists and belongs to organization
  const leadRecord = await db.query.lead.findFirst({
    where: and(
      eq(lead.id, parsed.data.leadId),
      eq(lead.organizationId, parsed.data.organizationId),
      notDeleted(lead)
    ),
  });

  if (!leadRecord) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'Lead not found or does not belong to this organization'
      )
    );
  }

  // ── Two different gates, deliberately scoped differently (ENG-792) ────────
  //
  // OVERLAP applies to EVERY source. A practitioner cannot be in two places at
  // once, and that is as true of a booking typed into the calendar as of one
  // made from the public page. This used to be skipped whenever
  // `source === 'manual'` — which is the DEFAULT on the wire, so the staff
  // calendar, the mobile funnels and `POST /v1/appointments` all took the
  // bypass. Two clashing appointments were created silently, both reported
  // "Appointment created", and the row was written with
  // `allow_double_booking = true`, removing it from the
  // `appointment_no_overlap` DB constraint as well. Nothing anywhere said no.
  //
  // Double-booking is still a supported workflow — it just has to be MEANT
  // now. A clash returns CONFLICT naming the other appointment; the caller
  // re-sends with `allowDoubleBooking: true` to accept it. Which is also what
  // the row is written with, so a deliberate overlap stays out of the DB
  // constraint while an ordinary booking is protected by it.
  //
  // AVAILABILITY stays online-only. Staff legitimately book outside posted
  // hours (a walk-in at 18:05, a Sunday call-out) and refusing that would be a
  // regression, not a fix — the issue reported is unseen CONFLICTS, not
  // out-of-hours bookings.
  const isManual = parsed.data.source === 'manual';
  const isActiveStatus = (
    activeAppointmentStatuses as readonly string[]
  ).includes(parsed.data.status);
  const allowDoubleBooking = parsed.data.allowDoubleBooking === true;

  // One org read for all three consumers below: availability resolution, the
  // primary-calendar fallback, and the staff notification's clock face. The
  // notification is unconditional, so this row is always needed — hoisting it
  // here replaces two previously-conditional lookups rather than adding a
  // third.
  const org = await db.query.organization.findFirst({
    where: and(
      eq(organization.id, parsed.data.organizationId),
      notDeleted(organization)
    ),
    columns: {
      timezone: true,
      businessHours: true,
      primaryCalendarAccountId: true,
    },
  });
  const orgTimeZone = org?.timezone ?? 'UTC';

  if (isActiveStatus && !allowDoubleBooking) {
    // WHO can be double-booked differs by source. An online booking is checked
    // against the assignee as well, which is how it has always behaved. A
    // staff-side booking is checked against the PRACTITIONER only: there,
    // `assignedToId` is just "whoever is logged in" (the controller defaults
    // it), so including it would make a receptionist booking two different
    // clients into two different chairs collide with herself.
    const overlap = await hasOverlappingAppointment(db, {
      startDate: parsed.data.startDate,
      endDate,
      assignedToId: isManual ? undefined : parsed.data.assignedToId,
      organizationId: parsed.data.organizationId,
      practitionerId: parsed.data.practitionerId ?? undefined,
    });

    if (overlap.hasConflict && overlap.conflictingAppointment) {
      const c = overlap.conflictingAppointment;

      // NAME THE BRANCH when the clash is at a different one.
      //
      // This check is org-wide on purpose — a practitioner cannot be in two
      // cities at once — so the appointment it finds is frequently NOT on the
      // calendar the user is looking at. Saying only "this time is already
      // booked" then points at a slot that is visibly empty, which reads as a
      // bug rather than a warning, and the rational next click is "Book
      // anyway". That is precisely how one person ends up booked at two sites
      // in the same half hour.
      //
      // Only when it DIFFERS: on a same-branch clash the appointment is right
      // there on screen and naming the branch is noise.
      const targetLocationId = await resolveTargetLocationId(
        db,
        parsed.data.organizationId,
        parsed.data.locationId ?? null
      );
      const conflictBranchName =
        c.locationId && c.locationId !== targetLocationId
          ? ((
              await db.query.organizationLocation.findFirst({
                where: eq(organizationLocation.id, c.locationId),
                columns: { name: true },
              })
            )?.name ?? null)
          : null;
      const atBranch = conflictBranchName ? ` at ${conflictBranchName}` : '';

      return err(
        new FeatureError(
          ErrorCodes.CONFLICT,
          // The message IS the confirmation prompt the staff calendar shows,
          // so it has to identify the clash in human terms — a bare "conflict"
          // gives the user nothing to decide with. Times are rendered in the
          // BUSINESS timezone for the same reason.
          `This overlaps "${c.title}"${atBranch} (${formatConflictRange(c.startDate, c.endDate, orgTimeZone)}) for the same team member.`,
          {
            conflictingAppointmentId: c.id,
            conflictStartDate: c.startDate.toISOString(),
            conflictEndDate: c.endDate.toISOString(),
            conflictLocationId: c.locationId,
            conflictLocationName: conflictBranchName,
          }
        )
      );
    }
  }

  if (!isManual && isActiveStatus) {
    if (parsed.data.practitionerId) {
      const availability = await resolveAvailability(db, {
        organizationId: parsed.data.organizationId,
        practitionerIds: [parsed.data.practitionerId],
        from: parsed.data.startDate,
        to: endDate,
        timeZone: orgTimeZone,
        orgBusinessHours: (org?.businessHours as WorkingHours | null) ?? null,
      });

      const pa = availability.find(
        (a) => a.practitionerId === parsed.data.practitionerId
      );
      if (!pa || !slotIsBookable(parsed.data.startDate, endDate, pa)) {
        return err(
          new FeatureError(
            ErrorCodes.CONFLICT,
            'The practitioner is not available at the requested time (outside their availability).'
          )
        );
      }
    }
  }

  // Resolve calendarAccountId:
  // 1. If practitionerId provided, prefer practitioner's calendar
  // 2. Fall back to provided calendarAccountId
  // 3. Fall back to org's primary calendar
  let calendarAccountId = parsed.data.calendarAccountId;

  if (parsed.data.practitionerId) {
    const prac = await db.query.practitioner.findFirst({
      where: and(
        eq(practitioner.id, parsed.data.practitionerId),
        eq(practitioner.organizationId, parsed.data.organizationId),
        notDeleted(practitioner)
      ),
      columns: {
        calendarAccountId: true,
        isActive: true,
        invitationPending: true,
        name: true,
      },
    });

    // Nobody can be booked against a person who has not joined the clinic yet
    // (ENG-794). The pickers already exclude them, so reaching this is either
    // a stale client or a direct API call — both of which would otherwise
    // produce an appointment no one has agreed to perform.
    if (prac?.invitationPending) {
      return err(
        new FeatureError(
          ErrorCodes.CONFLICT,
          `${prac.name} has not accepted their invitation yet, so they cannot be booked. Once they accept, they become bookable.`
        )
      );
    }

    if (prac?.calendarAccountId) {
      calendarAccountId = prac.calendarAccountId;
    }
  }

  if (!calendarAccountId) {
    calendarAccountId = org?.primaryCalendarAccountId ?? undefined;
  }

  // ── Branch stamping (gap 4) ───────────────────────────────────────────────
  //
  // EVERY appointment gets a branch here, not at the call sites. Only the
  // dashboard controller injects one (from the guard-validated
  // `X-Location-Id`); voice bookings, Claire's direct booking and the public
  // `POST /v1/appointments` key endpoint all call in without one. A NULL
  // `location_id` is not "unscoped" — `listAppointments` filters with a strict
  // `eq` (a NULL never matches), so such a row appears on NO branch's calendar
  // and is invisible forever. The customer still gets a confirmation.
  //
  // The backfill cannot fix this: it closes the NULLs once and the very next
  // booking from any of those three writers opens a new one. Hence the
  // fallback lives in the one place every writer passes through.
  //
  // ZERO-LOCATION ORG: `resolveDefaultLocation` returns null (an org created
  // before onboarding started making a location, or one mid-creation). We
  // write NULL and let the booking succeed. Throwing here would turn a
  // pre-existing data gap into a failed customer booking on the phone/chat
  // path — strictly worse than the invisible-row case, and something no
  // caller can recover from in-flight. Such an org has no branch calendar to
  // be missing from either; the row becomes visible the moment its first
  // location exists and the backfill runs.
  const locationId = await resolveTargetLocationId(
    db,
    parsed.data.organizationId,
    parsed.data.locationId ?? null
  );

  // Create appointment
  const [result] = await db
    .insert(appointment)
    .values({
      title: parsed.data.title,
      description: parsed.data.description,
      startDate: parsed.data.startDate,
      endDate,
      color: parsed.data.color,
      status: parsed.data.status,
      source: parsed.data.source,
      // Only a `held` row carries a clock. Storing one on any other status
      // would leave a stale date that the expiry cron ignores but a reader
      // could easily misread as live.
      holdExpiresAt:
        parsed.data.status === 'held'
          ? (parsed.data.holdExpiresAt ?? null)
          : null,
      leadId: parsed.data.leadId,
      assignedToId: parsed.data.assignedToId,
      organizationId: parsed.data.organizationId,
      locationId,
      calendarAccountId,
      externalCalendarEventId: parsed.data.externalCalendarEventId,
      practitionerId: parsed.data.practitionerId ?? null,
      serviceId: primaryServiceId,
      // Opting out of the `appointment_no_overlap` exclusion constraint is now
      // driven by the caller's EXPLICIT consent rather than by the source. A
      // manual booking that does not overlap anything is protected by the
      // constraint like any other; only an overlap the user confirmed is
      // exempt from it (ENG-792).
      allowDoubleBooking,
    })
    .returning();

  // Insert the cart line items in the SAME org scope as the appointment insert.
  // Snapshots (name/duration/price) are copied verbatim; each line's
  // practitioner defaults to the appointment's single practitioner (Fresha lets
  // this differ per line — modelled per-row now, a UI change later).
  if (hasCart) {
    await db.insert(appointmentService).values(
      cartItems.map((item, index) => ({
        appointmentId: result.id,
        serviceId: item.serviceId ?? null,
        name: item.name,
        durationMinutes: item.durationMinutes,
        priceCents: item.priceCents ?? null,
        practitionerId:
          item.practitionerId ?? parsed.data.practitionerId ?? null,
        sortOrder: item.sortOrder ?? index,
      }))
    );
  }

  // ── Resource allocation (rooms / equipment) ───────────────────────────────
  // Sits alongside the practitioner-conflict logic above and mirrors its
  // `isManual` split: an ONLINE booking that cannot get a required room is
  // refused outright; a manual/console one is accepted with a warning.
  //
  // Runs AFTER the insert because an allocation row needs an appointment id to
  // point at, and BEFORE every side effect below so that a refusal has nothing
  // to unwind but the row itself.
  //
  // A non-active status (a `cancelled` row back-entered from the console) holds
  // nothing: the lifecycle invariant in `release-appointment-resources.ts` says
  // allocations exist only while an appointment is active, and creating one
  // already-dead would violate it from birth.
  let resources: Array<{ categoryId: string; resourceId: string }> = [];
  let resourceWarnings: ResourceWarning[] = [];

  if (isActiveStatus) {
    try {
      const allocation = await allocateAppointmentResources(db, {
        organizationId: parsed.data.organizationId,
        appointmentId: result.id,
        serviceIds: hasCart
          ? cartItems
              .map((item) => item.serviceId)
              .filter((id): id is string => Boolean(id))
          : primaryServiceId
            ? [primaryServiceId]
            : [],
        startDate: parsed.data.startDate,
        endDate,
        timeZone: orgTimeZone,
        isManual,
        // The RESOLVED branch, not `parsed.data.locationId`. The three writers
        // with no `X-Location-Id` to inject from fall back to
        // `resolveDefaultLocation` above; passing the raw input here would
        // allocate their rooms unfiltered and hand a single-branch clinic's
        // booking a room from the other building.
        locationId,
        explicitResourceIds: parsed.data.resourceIds,
        allowResourceOverbook: parsed.data.allowResourceOverbook,
      });
      resources = allocation.allocated;
      resourceWarnings = allocation.warnings;
    } catch (error) {
      const featureError = asResourceFeatureError(error);
      if (!featureError) throw error;

      // The appointment MUST NOT survive a refusal — a customer told "that time
      // isn't available" and then finding a booking in their inbox is worse
      // than either outcome alone.
      //
      // Compensated by hand rather than left to a transaction rollback:
      // `withOrgScope` only opens a transaction when RLS enforcement is on, so
      // throwing would leave the row behind everywhere else. The delete is a
      // hard one (cart lines cascade) and nothing else has fired yet — no
      // conversion stamp, no calendar sync, no notification.
      try {
        await db
          .delete(appointment)
          .where(
            and(
              eq(appointment.id, result.id),
              eq(appointment.organizationId, parsed.data.organizationId)
            )
          );
      } catch (cleanupError) {
        // The refusal still stands — better to leave an orphan row for a human
        // to find than to tell a customer their unbookable slot was booked.
        logError(
          'appointments.createAppointment.resourceRollback',
          cleanupError,
          {
            feature: 'appointments',
            extra: {
              appointmentId: result.id,
              organizationId: parsed.data.organizationId,
            },
          }
        );
      }

      return err(featureError);
    }
  }

  // Stamp the conversion: the first booking of ANY kind is the trigger. A
  // transient `held` slot is not yet a booking, so it does not convert.
  // `recordLeadConversion` stamps `converted_at` once and is a no-op
  // thereafter; the derived stage reads it as `booked`. Best-effort — a failed
  // stamp must never fail the booking itself.
  if (parsed.data.status !== 'held') {
    try {
      await recordLeadConversion(db, {
        leadId: leadRecord.id,
        organizationId: leadRecord.organizationId,
        activityType: 'appointment_booked',
        activityDescription: 'Booked an appointment',
      });
    } catch (error) {
      logError('appointments.createAppointment.convertLead', error, {
        feature: 'appointments',
        extra: {
          organizationId: parsed.data.organizationId,
          leadId: parsed.data.leadId,
        },
      });
    }
  }

  // Durable calendar sync: enqueue onto the booking worker so a slow/failed
  // Google call is retried (and dead-lettered) rather than lost with the
  // request. Best-effort enqueue — never fails the booking.
  await enqueueCalendarSync({
    appointmentId: result.id,
    organizationId: parsed.data.organizationId,
    action: 'create',
  });

  // Fire-and-forget practitioner booking notification
  if (parsed.data.practitionerId) {
    notifyPractitionerBooking(db, {
      appointmentId: result.id,
      organizationId: parsed.data.organizationId,
    }).catch((error) =>
      logError('appointments.createAppointment.notifyPractitioner', error, {
        feature: 'appointments',
        extra: {
          appointmentId: result.id,
          organizationId: parsed.data.organizationId,
        },
      })
    );
  }

  // Fire-and-forget in-app notification
  const clientName = [leadRecord.firstName, leadRecord.lastName]
    .filter(Boolean)
    .join(' ');
  dispatchNotification(db, {
    organizationId: parsed.data.organizationId,
    type: 'appointment_booked',
    assigneeUserId: result.assignedToId ?? undefined,
    title: 'New appointment',
    body: `${clientName} booked an appointment for ${formatInOrgZone(orgTimeZone, result.startDate)}.`,
    linkPath: '/dashboard/appointments',
  }).catch((error) =>
    logError('appointments.createAppointment.dispatchNotification', error, {
      feature: 'appointments',
      extra: {
        appointmentId: result.id,
        organizationId: parsed.data.organizationId,
      },
    })
  );

  // ── Consent forms (ENG-647) ───────────────────────────────────────────────
  // Every appointment for a service with required consent templates gets its
  // submissions, whoever booked it.
  //
  // This used to run ONLY from the public booking form, so a clinic taking
  // most of its bookings by phone, at the desk, or through Claire generated
  // consent forms for almost none of them — while the product told them
  // consent was handled. For a legal instrument a partial record is worse
  // than an obviously absent one, because it gets trusted.
  //
  // Fire-and-forget and non-fatal, matching the public path: the appointment
  // is already committed and a consent-form failure must not fail the
  // booking. Idempotent at the DB level via
  // `uq_consent_form_submission_appointment_template`, so a retried create
  // cannot hand the patient a second copy of the same form.
  //
  // A RESCHEDULE needs nothing here: it updates start/end on the SAME
  // appointment row, so the existing submissions still point at it and nobody
  // is asked to re-sign what they already signed.
  if (result.serviceId) {
    createSubmissionsForAppointment(db, {
      appointmentId: result.id,
      leadId: result.leadId,
      organizationId: parsed.data.organizationId,
      serviceId: result.serviceId,
    }).catch((error) =>
      logError('appointments.createAppointment.consentForms', error, {
        feature: 'appointments',
        extra: {
          appointmentId: result.id,
          organizationId: parsed.data.organizationId,
        },
      })
    );
  }

  trackOrgEvent(parsed.data.organizationId, 'appointment_created', {
    appointmentId: result.id,
    source: parsed.data.source,
  });

  return ok({ ...result, resources, resourceWarnings });
};

export const createAppointment = (
  db: DbConnection,
  input: CreateAppointmentInput
) =>
  trackedResult(
    'appointments.createAppointment',
    () => withOrgScope((tx) => createAppointmentImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        leadId: input.leadId,
      },
    }
  );

export type CreateAppointmentResult = Awaited<
  ReturnType<typeof createAppointment>
>;
