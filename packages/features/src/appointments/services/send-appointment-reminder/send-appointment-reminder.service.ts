import {
  appointment,
  consentFormSubmission,
  lead,
  organization,
} from '@borradh-workspace/database';
import { AppointmentReminderEmail, sendEmail } from '@borradh-workspace/email';
import { activeAppointmentStatuses } from '@borradh-workspace/labels';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import {
  formatBookingLocationAddress,
  getBookingLocationById,
} from '../../../organization-locations/index.js';
import {
  buildPortalAccessUrl,
  mintMagicLink,
} from '../../../patient-auth/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  notDeleted,
  ok,
  resolveMicrositeLinkTarget,
} from '../../../shared/index.js';
import {
  type SendAppointmentReminderInput,
  sendAppointmentReminderSchema,
} from './send-appointment-reminder.schema.js';

interface SendAppointmentReminderResult {
  sent: boolean;
}

/**
 * Format an appointment instant for the CLIENT, in the BUSINESS's timezone.
 *
 * `timeZone` is REQUIRED. Omitting the option falls back to the SERVER's zone —
 * UTC on Fly — which told a Dublin client 13:00 for a 14:00 appointment and a
 * Californian client 16:00 for a 09:00 one. See send-reminders.service.ts for
 * the full history.
 */
function formatDate(
  date: Date,
  timeZone: string
): {
  formattedDate: string;
  formattedTime: string;
} {
  return {
    formattedDate: date.toLocaleDateString('en-US', {
      timeZone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    formattedTime: date.toLocaleTimeString('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
    }),
  };
}

/**
 * Send a single appointment reminder (24h or 1h). Designed to run as one BullMQ
 * job per appointment so the reminder throughput scales with worker concurrency
 * instead of a fixed per-tick batch (which silently dropped reminders once more
 * appointments fell in a window than the batch could drain).
 *
 * Idempotent under retries and duplicate jobs via a claim-then-send pattern:
 *   1. Atomically flip the reminder-sent column from NULL → now() (the "claim").
 *      Only the first runner wins; a duplicate/retry claims nothing and no-ops.
 *   2. Send the email. If it throws, RESET the flag so the job can retry —
 *      otherwise a transient email failure would permanently suppress the
 *      reminder.
 */
const sendAppointmentReminderImpl = async (
  db: DbConnection,
  input: SendAppointmentReminderInput
): Promise<Result<SendAppointmentReminderResult>> => {
  const parsed = sendAppointmentReminderSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      }),
    };
  }

  const { appointmentId, kind } = parsed.data;
  const sentColumn =
    kind === '24h'
      ? appointment.reminderSentAt24h
      : appointment.reminderSentAt1h;

  // 1. Claim: only proceed if this reminder hasn't been sent and the appointment
  // is still active. RETURNING tells us whether we won the claim.
  const claimed = await db
    .update(appointment)
    .set(
      kind === '24h'
        ? { reminderSentAt24h: new Date() }
        : { reminderSentAt1h: new Date() }
    )
    .where(
      and(
        eq(appointment.id, appointmentId),
        isNull(sentColumn),
        inArray(appointment.status, [...activeAppointmentStatuses]),
        notDeleted(appointment)
      )
    )
    .returning({
      id: appointment.id,
      title: appointment.title,
      startDate: appointment.startDate,
      leadId: appointment.leadId,
      organizationId: appointment.organizationId,
      // The BRANCH this appointment is at. Returned from the claim rather than
      // re-read later because this is the only row we are guaranteed to hold.
      // Nullable: `createAppointment` stamps one on every new row, but rows
      // predating the location backfill still carry NULL — those render no
      // address at all (see below), never the default branch's.
      locationId: appointment.locationId,
    });

  if (claimed.length === 0) {
    // Already sent, cancelled, or gone — nothing to do (idempotent no-op).
    return ok({ sent: false });
  }

  const appt = claimed[0];

  try {
    const leadRecord = await db.query.lead.findFirst({
      where: and(eq(lead.id, appt.leadId), notDeleted(lead)),
    });

    if (!leadRecord?.email) {
      // No email to send to — keep the claim (nothing to retry).
      return ok({ sent: false });
    }

    const org = await db.query.organization.findFirst({
      where: and(
        eq(organization.id, appt.organizationId),
        notDeleted(organization)
      ),
      // `timezone` formats the reminder time (main); `slug` builds the portal
      // access URL for outstanding consent forms (this branch). Both are read
      // below — dropping either silently degrades one of the two features.
      columns: { name: true, timezone: true, slug: true },
    });

    // How many consent forms are still unsigned for this appointment — surfaced
    // in the reminder as "You have N form(s) to complete." so a patient who
    // ignored the original consent email gets a second nudge before arriving.
    const [pending] = await db
      .select({ value: count() })
      .from(consentFormSubmission)
      .where(
        and(
          eq(consentFormSubmission.appointmentId, appt.id),
          eq(consentFormSubmission.status, 'pending')
        )
      );
    const pendingFormCount = pending?.value ?? 0;

    // Only mint a one-tap portal link when there are actually forms to complete
    // (no point signing the patient in just to see nothing pending). Best-effort
    // — if minting fails the line still renders without a link.
    let portalUrl: string | undefined;
    if (pendingFormCount > 0 && org?.slug) {
      const link = await mintMagicLink(db, {
        leadId: appt.leadId,
        organizationId: appt.organizationId,
      });
      if (link.success) {
        const linkTarget = await resolveMicrositeLinkTarget(db, {
          id: appt.organizationId,
          slug: org.slug,
        });
        portalUrl = buildPortalAccessUrl(linkTarget, link.data.token);
      } else {
        logError('appointments.sendAppointmentReminder.magicLink', link.error, {
          feature: 'appointments',
          extra: {
            appointmentId: appt.id,
            organizationId: appt.organizationId,
          },
        });
      }
    }

    // The branch the patient is actually going to. `getBookingLocationById`
    // has NO default-branch fallback on purpose: a NULL `location_id` (every
    // pre-backfill row) yields `null` here and the template omits the location
    // line. Telling a Cork patient nothing is recoverable; sending them to
    // Dublin is not.
    const apptLocation = await getBookingLocationById(
      db,
      appt.organizationId,
      appt.locationId
    );
    const organizationAddress =
      formatBookingLocationAddress(apptLocation) ?? undefined;

    const leadName =
      `${leadRecord.firstName ?? ''} ${leadRecord.lastName ?? ''}`.trim() ||
      'there';
    const { formattedDate, formattedTime } = formatDate(
      appt.startDate,
      org?.timezone || 'UTC'
    );

    await sendEmail({
      to: leadRecord.email,
      subject:
        kind === '24h'
          ? `Reminder: ${appt.title} tomorrow`
          : `Reminder: ${appt.title} in 1 hour`,
      template: AppointmentReminderEmail,
      props: {
        leadName,
        appointmentTitle: appt.title,
        formattedDate,
        formattedTime,
        timeUntil: kind === '24h' ? '24 hours' : '1 hour',
        organizationName: org?.name ?? 'Our Team',
        organizationAddress,
        pendingFormCount,
        portalUrl,
      },
    });

    return ok({ sent: true });
  } catch (error) {
    // Send failed — release the claim so a retry re-attempts, then rethrow so
    // BullMQ records the failure and schedules the retry.
    await db
      .update(appointment)
      .set(
        kind === '24h'
          ? { reminderSentAt24h: null }
          : { reminderSentAt1h: null }
      )
      .where(eq(appointment.id, appointmentId));
    throw error;
  }
};

export const sendAppointmentReminder = (
  db: DbConnection,
  input: SendAppointmentReminderInput
) =>
  trackedResult(
    'appointments.sendAppointmentReminder',
    () => sendAppointmentReminderImpl(db, input),
    { trackSuccess: false, trackFailure: false }
  );

export type SendAppointmentReminderServiceResult = Awaited<
  ReturnType<typeof sendAppointmentReminder>
>;
