import {
  appointment,
  lead,
  organization,
  withOrgScope,
} from '@borradh-workspace/database';
import { activeAppointmentStatuses } from '@borradh-workspace/labels';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { dispatchNotification } from '../../../notifications/services/dispatch-notification/dispatch-notification.service.js';
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
import { notifyPractitionerCancellation } from '../notify-practitioner-cancellation/notify-practitioner-cancellation.service.js';
import { sendRescheduleEmail } from '../send-reschedule-email/send-reschedule-email.service.js';
import {
  type AllocatedResource,
  type ResourceWarning,
  asResourceFeatureError,
  checkAppointmentResourcesAvailable,
  reallocateAppointmentResources,
  resolveAppointmentServiceIds,
} from '../shared/allocate-appointment-resources.js';
import { releaseAppointmentResources } from '../shared/release-appointment-resources.js';
import {
  type UpdateAppointmentInput,
  updateAppointmentSchema,
} from './update-appointment.schema.js';

/**
 * The updated appointment row, plus what the update did with the clinic's
 * rooms. Both extra keys are ADDITIVE — existing callers read the appointment
 * fields off the same object and are untouched.
 */
export type UpdatedAppointment = typeof appointment.$inferSelect & {
  resources: AllocatedResource[];
  resourceWarnings: ResourceWarning[];
};

const updateAppointmentImpl = async (
  db: DbConnection,
  input: UpdateAppointmentInput
): Promise<Result<UpdatedAppointment>> => {
  const parsed = updateAppointmentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    id,
    organizationId,
    sendRescheduleEmail: shouldSendEmail,
    rescheduleMessage,
    ...updateData
  } = parsed.data;

  // Check appointment exists
  const existing = await db.query.appointment.findFirst({
    where: and(
      eq(appointment.id, id),
      eq(appointment.organizationId, organizationId),
      notDeleted(appointment)
    ),
  });

  if (!existing) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Appointment not found'));
  }

  // If leadId is being updated, verify it belongs to the organization
  if (updateData.leadId) {
    const leadRecord = await db.query.lead.findFirst({
      where: and(
        eq(lead.id, updateData.leadId),
        eq(lead.organizationId, organizationId),
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
  }

  const effectiveStatus = updateData.status ?? existing.status;
  const schedulingChanged =
    updateData.startDate !== undefined ||
    updateData.endDate !== undefined ||
    updateData.assignedToId !== undefined ||
    updateData.practitionerId !== undefined;

  // The org timezone is needed on two paths — naming a clash in the CONFLICT
  // prompt, and the in-app notifications below — and on neither by default.
  // Resolve it at most once, and only when a path actually asks.
  let resolvedOrgTimeZone: string | null = null;
  const resolveOrgTimeZone = async (): Promise<string> => {
    if (resolvedOrgTimeZone === null) {
      const org = await db.query.organization.findFirst({
        where: and(
          eq(organization.id, organizationId),
          notDeleted(organization)
        ),
        columns: { timezone: true },
      });
      resolvedOrgTimeZone = org?.timezone ?? 'UTC';
    }
    return resolvedOrgTimeZone;
  };

  // Overlap enforcement, mirroring createAppointment (ENG-792): it applies to
  // EVERY source, not just customer-facing ones. Dragging an appointment on the
  // staff calendar is a reschedule like any other, and it took the same
  // `source === 'manual'` bypass — so a drag could drop one booking on top of
  // another with no warning. Staff may still double-book deliberately by
  // re-sending with `allowDoubleBooking: true`.
  //
  // The check runs whenever the result is active AND either the timing changed
  // or it is being (re)activated.
  const effectiveIsActive = (
    activeAppointmentStatuses as readonly string[]
  ).includes(effectiveStatus);
  const existingIsActive = (
    activeAppointmentStatuses as readonly string[]
  ).includes(existing.status);
  const isManual = existing.source === 'manual';
  // Absent means "keep whatever this row already decided": an appointment
  // created as a deliberate overlap must stay reschedulable without the caller
  // having to re-assert consent on every edit.
  const allowDoubleBooking =
    updateData.allowDoubleBooking ?? existing.allowDoubleBooking === true;

  if (
    !allowDoubleBooking &&
    effectiveIsActive &&
    (schedulingChanged || !existingIsActive)
  ) {
    const assignedToId = updateData.assignedToId ?? existing.assignedToId;
    const overlap = await hasOverlappingAppointment(db, {
      startDate: updateData.startDate ?? existing.startDate,
      endDate: updateData.endDate ?? existing.endDate,
      // Practitioner-only for staff-side appointments — see the same note in
      // createAppointment for why the assignee is the wrong subject there.
      assignedToId: isManual ? undefined : (assignedToId ?? undefined),
      organizationId,
      practitionerId:
        updateData.practitionerId ?? existing.practitionerId ?? undefined,
      excludeId: id,
    });

    if (overlap.hasConflict && overlap.conflictingAppointment) {
      const c = overlap.conflictingAppointment;
      // Same prompt the staff calendar shows on create: the clash has to be
      // named in the BUSINESS timezone or the "book anyway" decision is made
      // against a UTC clock face.
      const orgTimeZone = await resolveOrgTimeZone();
      return err(
        new FeatureError(
          ErrorCodes.CONFLICT,
          `This overlaps "${c.title}" (${formatConflictRange(c.startDate, c.endDate, orgTimeZone)}) for the same team member.`,
          {
            conflictingAppointmentId: c.id,
            conflictStartDate: c.startDate.toISOString(),
            conflictEndDate: c.endDate.toISOString(),
          }
        )
      );
    }

    // Resource gate (rooms / equipment). Online only, and explicitly so.
    //
    // ⚠️ This used to inherit the enclosing `!isManual`. ENG-792 deliberately
    // widened that guard to `!allowDoubleBooking`, because a console DRAG must
    // still be checked for a practitioner clash — which silently pulled this
    // gate onto the console path too. A manual move can never be refused for a
    // room (the front desk is allowed to overbook one; `reallocate` below
    // warns instead), so running it there buys nothing and costs two queries
    // per drag. Keeping the condition here states the rule where it applies
    // rather than borrowing someone else's.
    //
    // Runs BEFORE the write so a refusal leaves nothing to unwind, exactly like
    // the overlap check. `excludeAppointmentIds` keeps the appointment from
    // conflicting with the holds it already owns.
    if (!isManual) {
      const resourceConflict = await checkAppointmentResourcesAvailable(db, {
        organizationId,
        serviceIds: await resolveAppointmentServiceIds(
          db,
          id,
          updateData.serviceId ?? existing.serviceId
        ),
        startDate: updateData.startDate ?? existing.startDate,
        endDate: updateData.endDate ?? existing.endDate,
        timeZone: await resolveOrgTimeZone(),
        isManual,
        excludeAppointmentIds: [id],
      });
      if (resourceConflict) return err(resourceConflict);
    }
  }

  // Build update object (only include defined fields)
  const updateValues: Record<string, unknown> = {};

  if (updateData.title !== undefined) updateValues.title = updateData.title;
  if (updateData.description !== undefined)
    updateValues.description = updateData.description;
  if (updateData.startDate !== undefined)
    updateValues.startDate = updateData.startDate;
  if (updateData.endDate !== undefined)
    updateValues.endDate = updateData.endDate;
  if (updateData.color !== undefined) updateValues.color = updateData.color;
  if (updateData.status !== undefined) updateValues.status = updateData.status;
  if (updateData.leadId !== undefined) updateValues.leadId = updateData.leadId;
  if (updateData.assignedToId !== undefined)
    updateValues.assignedToId = updateData.assignedToId;
  if (updateData.calendarAccountId !== undefined)
    updateValues.calendarAccountId = updateData.calendarAccountId;
  if (updateData.externalCalendarEventId !== undefined)
    updateValues.externalCalendarEventId = updateData.externalCalendarEventId;
  if (updateData.practitionerId !== undefined)
    updateValues.practitionerId = updateData.practitionerId;
  if (updateData.serviceId !== undefined)
    updateValues.serviceId = updateData.serviceId;
  // Persist an explicit double-booking consent so the row's membership of the
  // `appointment_no_overlap` constraint matches the decision that was actually
  // made. Absent leaves the existing value alone.
  if (updateData.allowDoubleBooking !== undefined)
    updateValues.allowDoubleBooking = updateData.allowDoubleBooking;

  // Update appointment
  const [result] = await db
    .update(appointment)
    .set(updateValues)
    .where(
      and(
        eq(appointment.id, id),
        eq(appointment.organizationId, organizationId),
        notDeleted(appointment)
      )
    )
    .returning();

  // ── Resource lifecycle (see release-appointment-resources.ts) ─────────────
  // Allocations exist ONLY while an appointment is active. Anything that leaves
  // an active status frees its rooms; anything that MOVES an active
  // appointment re-takes them at the new time.
  //
  // "Active" is derived from `activeAppointmentStatuses`, never a hardcoded
  // list of cancelled/no_show — a status added later must not quietly start
  // leaking rooms.
  let resources: AllocatedResource[] = [];
  let resourceWarnings: ResourceWarning[] = [];

  if (!effectiveIsActive) {
    // Unconditional on a non-active result rather than only on the transition:
    // deleting zero rows is free, and it self-heals an appointment whose
    // release was missed or failed earlier.
    const released = await releaseAppointmentResources(db, {
      appointmentId: id,
      organizationId,
    });
    if (!released.success) {
      logError(
        'appointments.updateAppointment.releaseResources',
        new Error(released.error.message),
        {
          feature: 'appointments',
          extra: { appointmentId: id, organizationId },
        }
      );
    }
  } else if (schedulingChanged || !existingIsActive) {
    try {
      const allocation = await reallocateAppointmentResources(db, {
        appointmentId: id,
        organizationId,
      });
      resources = allocation.allocated;
      resourceWarnings = allocation.warnings;
    } catch (error) {
      // The move has already committed, so a failure here cannot be turned into
      // a refusal — that would leave the appointment moved AND the caller told
      // it was not. Log it: the appointment is simply holding nothing, which is
      // visible on the rooms calendar and fixable from the reassign UI.
      const featureError = asResourceFeatureError(error);
      if (!featureError) throw error;
      logError(
        'appointments.updateAppointment.reallocateResources',
        new Error(featureError.message),
        {
          feature: 'appointments',
          extra: { appointmentId: id, organizationId },
        }
      );
    }
  }

  // Durable calendar sync: enqueue onto the booking worker (retried + DLQ)
  // instead of a fire-and-forget promise that dies on restart.
  await enqueueCalendarSync({
    appointmentId: id,
    organizationId,
    action: 'update',
  });

  // Fire-and-forget reschedule email if requested and scheduling changed
  if (shouldSendEmail && schedulingChanged) {
    sendRescheduleEmail(db, {
      appointmentId: id,
      organizationId,
      oldStartDate: existing.startDate,
      oldEndDate: existing.endDate,
      customMessage: rescheduleMessage,
    }).catch((error) => {
      logError('appointments.updateAppointment.rescheduleEmail', error, {
        feature: 'appointments',
        extra: { appointmentId: id, organizationId },
      });
    });
  }

  // Fire-and-forget practitioner cancellation notification
  if (
    updateData.status === 'cancelled' &&
    existing.status !== 'cancelled' &&
    existing.practitionerId
  ) {
    notifyPractitionerCancellation(db, {
      appointmentId: id,
      organizationId,
    }).catch((error) => {
      logError(
        'appointments.updateAppointment.practitionerCancellation',
        error,
        {
          feature: 'appointments',
          extra: { appointmentId: id, organizationId },
        }
      );
    });
  }

  // Both in-app notifications print a clock face, so they need the business's
  // own zone — the server runs UTC and an omitted `timeZone` would silently
  // render every non-UTC org's appointment at the wrong time. Only read it on
  // the paths that actually notify.
  const notifiesCancelled =
    updateData.status === 'cancelled' && existing.status !== 'cancelled';
  const notifiesRescheduled =
    schedulingChanged && effectiveStatus !== 'cancelled';

  const orgTimeZone =
    notifiesCancelled || notifiesRescheduled
      ? await resolveOrgTimeZone()
      : 'UTC';

  // Fire-and-forget in-app cancellation notification
  if (notifiesCancelled) {
    dispatchNotification(db, {
      organizationId,
      type: 'appointment_cancelled',
      assigneeUserId: existing.assignedToId ?? undefined,
      title: 'Appointment cancelled',
      body: `"${existing.title}" on ${formatInOrgZone(orgTimeZone, existing.startDate)} was cancelled.`,
      linkPath: '/dashboard/appointments',
    }).catch((error) => {
      logError('appointments.updateAppointment.dispatchCancelled', error, {
        feature: 'appointments',
        extra: { appointmentId: id, organizationId },
      });
    });
  }

  // Fire-and-forget in-app reschedule notification
  if (notifiesRescheduled) {
    const newStartDate = updateData.startDate ?? existing.startDate;
    dispatchNotification(db, {
      organizationId,
      type: 'appointment_rescheduled',
      assigneeUserId: existing.assignedToId ?? undefined,
      title: 'Appointment rescheduled',
      body: `"${existing.title}" was rescheduled to ${formatInOrgZone(orgTimeZone, newStartDate)}.`,
      linkPath: '/dashboard/appointments',
    }).catch((error) => {
      logError('appointments.updateAppointment.dispatchRescheduled', error, {
        feature: 'appointments',
        extra: { appointmentId: id, organizationId },
      });
    });
  }

  return ok({ ...result, resources, resourceWarnings });
};

export const updateAppointment = (
  db: DbConnection,
  input: UpdateAppointmentInput
) =>
  trackedResult(
    'appointments.updateAppointment',
    () => withOrgScope((tx) => updateAppointmentImpl(tx, input), { db }),
    {
      properties: { id: input.id, organizationId: input.organizationId },
    }
  );

export type UpdateAppointmentResult = Awaited<
  ReturnType<typeof updateAppointment>
>;
