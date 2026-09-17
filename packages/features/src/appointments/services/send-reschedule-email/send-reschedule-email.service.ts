import {
  appointment,
  lead,
  organization,
  withOrgScope,
} from '@borradh-workspace/database';
import {
  AppointmentRescheduleEmail,
  sendEmail,
} from '@borradh-workspace/email';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  formatBookingLocationAddress,
  getBookingLocationById,
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
  type SendRescheduleEmailInput,
  sendRescheduleEmailSchema,
} from './send-reschedule-email.schema.js';

interface SendRescheduleEmailResult {
  sent: boolean;
  reason?: string;
}

/**
 * Format an appointment instant in the BUSINESS's timezone. `timeZone` is
 * REQUIRED — omitting the option falls back to the SERVER's zone (UTC on Fly).
 * See send-reminders.service.ts for the full history.
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

const sendRescheduleEmailImpl = async (
  db: DbConnection,
  input: SendRescheduleEmailInput
): Promise<Result<SendRescheduleEmailResult>> => {
  const parsed = sendRescheduleEmailSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { appointmentId, organizationId, oldStartDate, customMessage } =
    parsed.data;

  // Fetch the appointment
  const appt = await db.query.appointment.findFirst({
    where: and(
      eq(appointment.id, appointmentId),
      eq(appointment.organizationId, organizationId),
      notDeleted(appointment)
    ),
  });

  if (!appt) {
    return ok({ sent: false, reason: 'Appointment not found' });
  }

  // Fetch the lead
  if (!appt.leadId) {
    return ok({ sent: false, reason: 'No lead associated with appointment' });
  }

  const leadRecord = await db.query.lead.findFirst({
    where: and(eq(lead.id, appt.leadId), notDeleted(lead)),
  });

  if (!leadRecord?.email) {
    return ok({ sent: false, reason: 'Lead has no email address' });
  }

  // Fetch the organization name
  const org = await db.query.organization.findFirst({
    where: and(eq(organization.id, organizationId), notDeleted(organization)),
    columns: { name: true, timezone: true },
  });

  const leadName =
    `${leadRecord.firstName ?? ''} ${leadRecord.lastName ?? ''}`.trim() ||
    'there';
  const orgName = org?.name ?? 'Our Team';
  const orgTimeZone = org?.timezone || 'UTC';

  // The branch the patient is going to. Explicit id, no default-branch
  // fallback: a NULL `location_id` (every pre-backfill row) renders no location
  // line rather than another branch's address.
  const apptLocation = await getBookingLocationById(
    db,
    organizationId,
    appt.locationId
  );
  const organizationAddress =
    formatBookingLocationAddress(apptLocation) ?? undefined;

  const oldFormatted = formatDate(oldStartDate, orgTimeZone);
  const newFormatted = formatDate(appt.startDate, orgTimeZone);

  try {
    await sendEmail({
      to: leadRecord.email,
      subject: `Your appointment "${appt.title}" has been rescheduled`,
      template: AppointmentRescheduleEmail,
      props: {
        leadName,
        appointmentTitle: appt.title,
        oldFormattedDate: oldFormatted.formattedDate,
        oldFormattedTime: oldFormatted.formattedTime,
        newFormattedDate: newFormatted.formattedDate,
        newFormattedTime: newFormatted.formattedTime,
        organizationName: orgName,
        organizationAddress,
        customMessage,
      },
    });

    return ok({ sent: true });
  } catch (error) {
    logError('appointments.sendRescheduleEmail', error, {
      feature: 'appointments',
      extra: { appointmentId, leadEmail: leadRecord.email },
    });
    return ok({ sent: false, reason: 'Failed to send email' });
  }
};

export const sendRescheduleEmail = (
  db: DbConnection,
  input: SendRescheduleEmailInput
) =>
  trackedResult(
    'appointments.sendRescheduleEmail',
    () => withOrgScope((tx) => sendRescheduleEmailImpl(tx, input), { db }),
    {
      properties: { appointmentId: input.appointmentId },
    }
  );

export type SendRescheduleEmailServiceResult = Awaited<
  ReturnType<typeof sendRescheduleEmail>
>;
