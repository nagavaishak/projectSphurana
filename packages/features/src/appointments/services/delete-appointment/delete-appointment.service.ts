import { appointment, withOrgScope } from '@borradh-workspace/database';
import {
  isFeatureOn,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { syncToCalendar } from '../../../calendar/services/sync-to-calendar/sync-to-calendar.service.js';
import {
  SIGNED_CONSENT_BLOCKS_DELETE,
  releasePendingConsentForms,
} from '../../../consent-forms/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  logAuditEvent,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { notifyPractitionerCancellation } from '../notify-practitioner-cancellation/notify-practitioner-cancellation.service.js';
import { releaseAppointmentResources } from '../shared/release-appointment-resources.js';
import {
  type DeleteAppointmentInput,
  deleteAppointmentSchema,
} from './delete-appointment.schema.js';

const deleteAppointmentImpl = async (
  db: DbConnection,
  input: DeleteAppointmentInput,
  auditDb: DbConnection = db
): Promise<Result<{ success: true }>> => {
  const parsed = deleteAppointmentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  if (!(await isFeatureOn('killswitch-soft-deletes'))) {
    // Hard delete. `consent_form_submission.appointment_id` is ON DELETE
    // RESTRICT (0136) so a SIGNED consent can never be destroyed as a side
    // effect of tidying the diary. Drop the pending forms — they only ever
    // referred to this appointment — then refuse if anything executed
    // remains, with a message that says why rather than an FK 500.
    const { signedCount } = await releasePendingConsentForms(db, {
      appointmentId: parsed.data.id,
    });
    if (signedCount > 0) {
      return err(
        new FeatureError(ErrorCodes.CONFLICT, SIGNED_CONSENT_BLOCKS_DELETE, {
          appointmentId: parsed.data.id,
          signedConsentForms: signedCount,
        })
      );
    }

    // `appointment_resource.appointment_id` is ON DELETE CASCADE, so a HARD
    // delete frees the rooms by itself — no explicit release needed here. The
    // soft-delete path below has no such help and must release by hand.
    await db
      .delete(appointment)
      .where(
        and(
          eq(appointment.id, parsed.data.id),
          eq(appointment.organizationId, parsed.data.organizationId)
        )
      );
    return ok({ success: true });
  }

  // Check appointment exists
  const existing = await db.query.appointment.findFirst({
    where: and(
      eq(appointment.id, parsed.data.id),
      eq(appointment.organizationId, parsed.data.organizationId),
      notDeleted(appointment)
    ),
  });

  if (!existing) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Appointment not found'));
  }

  // Fire-and-forget practitioner cancellation notification (before deletion)
  if (existing.practitionerId) {
    notifyPractitionerCancellation(db, {
      appointmentId: parsed.data.id,
      organizationId: parsed.data.organizationId,
    }).catch((error) => {
      logError(
        'appointments.deleteAppointment.practitionerCancellation',
        error,
        {
          feature: 'appointments',
          extra: {
            appointmentId: parsed.data.id,
            organizationId: parsed.data.organizationId,
          },
        }
      );
    });
  }

  // Sync calendar deletion before removing the record (needs the event ID)
  if (existing.externalCalendarEventId) {
    await syncToCalendar(db, {
      appointmentId: parsed.data.id,
      organizationId: parsed.data.organizationId,
      action: 'delete',
    }).catch((error) => {
      logError('appointments.deleteAppointment.calendarSync', error, {
        feature: 'appointments',
        extra: {
          appointmentId: parsed.data.id,
          organizationId: parsed.data.organizationId,
        },
      });
    });
  }

  await db
    .update(appointment)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(appointment.id, parsed.data.id),
        eq(appointment.organizationId, parsed.data.organizationId),
        notDeleted(appointment)
      )
    );

  // Free the rooms. A SOFT delete leaves the row in place, so nothing cascades
  // and nothing else will ever come back for these holds — miss this and the
  // deleted appointment blocks its room against every future booking, forever.
  // (See the invariant in release-appointment-resources.ts.)
  const releasedResources = await releaseAppointmentResources(db, {
    appointmentId: parsed.data.id,
    organizationId: parsed.data.organizationId,
  });
  if (!releasedResources.success) {
    logError(
      'appointments.deleteAppointment.releaseResources',
      new Error(releasedResources.error.message),
      {
        feature: 'appointments',
        extra: {
          appointmentId: parsed.data.id,
          organizationId: parsed.data.organizationId,
        },
      }
    );
  }

  logAuditEvent(auditDb, {
    action: 'delete',
    entityType: 'appointment',
    entityId: parsed.data.id,
    actorType: 'user',
    actorId: parsed.data.actorId ?? null,
    organizationId: parsed.data.organizationId,
  }).catch((error) => {
    logError('appointments.deleteAppointment.auditLog', error, {
      feature: 'appointments',
      extra: {
        appointmentId: parsed.data.id,
        organizationId: parsed.data.organizationId,
      },
    });
  });

  return ok({ success: true });
};

export const deleteAppointment = (
  db: DbConnection,
  input: DeleteAppointmentInput
) =>
  trackedResult(
    'appointments.deleteAppointment',
    () => withOrgScope((tx) => deleteAppointmentImpl(tx, input, db), { db }),
    {
      properties: { id: input.id },
    }
  );

export type DeleteAppointmentResult = Awaited<
  ReturnType<typeof deleteAppointment>
>;
