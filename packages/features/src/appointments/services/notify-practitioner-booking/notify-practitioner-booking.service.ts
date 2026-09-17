import {
  appointment,
  lead,
  organization,
  practitioner,
  withOrgScope,
} from '@borradh-workspace/database';
import {
  PractitionerBookingNotificationEmail,
  sendEmail,
} from '@borradh-workspace/email';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
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
  type NotifyPractitionerBookingInput,
  notifyPractitionerBookingSchema,
} from './notify-practitioner-booking.schema.js';

interface NotifyPractitionerBookingResult {
  sent: boolean;
  reason?: string;
}

// `timeZone` is required, not optional: the server process runs in UTC, so an
// omitted zone silently renders every non-UTC org's appointment at the wrong
// clock time. Callers must pass the organization's zone.
function formatDate(
  timeZone: string,
  date: Date
): {
  formattedDate: string;
  formattedTime: string;
} {
  return {
    formattedDate: date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone,
    }),
    formattedTime: date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    }),
  };
}

const notifyPractitionerBookingImpl = async (
  db: DbConnection,
  input: NotifyPractitionerBookingInput
): Promise<Result<NotifyPractitionerBookingResult>> => {
  const parsed = notifyPractitionerBookingSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { appointmentId, organizationId } = parsed.data;

  // Fetch the appointment
  const appt = await db.query.appointment.findFirst({
    where: and(
      eq(appointment.id, appointmentId),
      eq(appointment.organizationId, organizationId),
      notDeleted(appointment)
    ),
  });

  if (!appt || !appt.practitionerId) {
    return ok({ sent: false, reason: 'No practitioner assigned' });
  }

  // Fetch the practitioner
  const prac = await db.query.practitioner.findFirst({
    where: and(
      eq(practitioner.id, appt.practitionerId),
      eq(practitioner.organizationId, organizationId),
      notDeleted(practitioner)
    ),
  });

  if (!prac || !prac.email) {
    return ok({ sent: false, reason: 'Practitioner has no email address' });
  }

  // Fetch the lead (client info)
  let clientName = 'A customer';
  let clientEmail: string | null = null;
  let clientPhone: string | null = null;

  if (appt.leadId) {
    const leadRecord = await db.query.lead.findFirst({
      where: and(eq(lead.id, appt.leadId), notDeleted(lead)),
    });

    if (leadRecord) {
      clientName =
        `${leadRecord.firstName ?? ''} ${leadRecord.lastName ?? ''}`.trim() ||
        'A customer';
      clientEmail = leadRecord.email;
      clientPhone = leadRecord.phone;
    }
  }

  // Fetch the organization name and its timezone (times are rendered in the
  // business's own zone, not the UTC the server process runs in)
  const org = await db.query.organization.findFirst({
    where: and(eq(organization.id, organizationId), notDeleted(organization)),
    columns: { name: true, timezone: true },
  });

  const orgName = org?.name ?? 'The Team';
  const { formattedDate, formattedTime } = formatDate(
    org?.timezone || 'UTC',
    appt.startDate
  );

  try {
    await sendEmail({
      to: prac.email,
      subject: `New Booking: ${clientName} — ${appt.title}`,
      template: PractitionerBookingNotificationEmail,
      props: {
        practitionerName: prac.name,
        clientName,
        serviceName: null, // Could be resolved from booking form if needed
        appointmentTitle: appt.title,
        formattedDate,
        formattedTime,
        clientEmail,
        clientPhone,
        clientNotes: appt.description,
        organizationName: orgName,
      },
    });

    return ok({ sent: true });
  } catch (error) {
    logError('appointments.notifyPractitionerBooking', error, {
      feature: 'appointments',
      extra: { appointmentId, practitionerEmail: prac.email },
    });
    return ok({ sent: false, reason: 'Failed to send email' });
  }
};

export const notifyPractitionerBooking = (
  db: DbConnection,
  input: NotifyPractitionerBookingInput
) =>
  trackedResult(
    'appointments.notifyPractitionerBooking',
    () =>
      withOrgScope((tx) => notifyPractitionerBookingImpl(tx, input), { db }),
    {
      properties: { appointmentId: input.appointmentId },
    }
  );

export type NotifyPractitionerBookingServiceResult = Awaited<
  ReturnType<typeof notifyPractitionerBooking>
>;
