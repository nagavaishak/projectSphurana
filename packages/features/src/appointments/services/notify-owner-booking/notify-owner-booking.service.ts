import {
  appointment,
  lead,
  member,
  organization,
  practitioner,
  withOrgScope,
} from '@borradh-workspace/database';
import {
  OwnerBookingNotificationEmail,
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
  type NotifyOwnerBookingInput,
  notifyOwnerBookingSchema,
} from './notify-owner-booking.schema.js';

interface NotifyOwnerBookingResult {
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
    formattedDate: date.toLocaleDateString('en-IE', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone,
    }),
    formattedTime: date.toLocaleTimeString('en-IE', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone,
    }),
  };
}

const notifyOwnerBookingImpl = async (
  db: DbConnection,
  input: NotifyOwnerBookingInput
): Promise<Result<NotifyOwnerBookingResult>> => {
  const parsed = notifyOwnerBookingSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { appointmentId, organizationId } = parsed.data;

  // Find the organization owner
  const ownerMember = await db.query.member.findFirst({
    where: and(
      eq(member.organizationId, organizationId),
      eq(member.role, 'owner')
    ),
    with: { user: true },
  });

  if (!ownerMember?.user?.email) {
    return ok({ sent: false, reason: 'No owner found or owner has no email' });
  }

  // Don't send if the owner is also the assigned practitioner — they already get the practitioner notification
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

  if (appt.practitionerId) {
    const prac = await db.query.practitioner.findFirst({
      where: and(
        eq(practitioner.id, appt.practitionerId),
        eq(practitioner.organizationId, organizationId),
        notDeleted(practitioner)
      ),
    });

    if (prac?.email === ownerMember.user.email) {
      return ok({
        sent: false,
        reason: 'Owner is the assigned practitioner — already notified',
      });
    }
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
  const orgTimeZone = org?.timezone || 'UTC';

  // Fetch practitioner name if assigned
  let practitionerName: string | null = null;
  if (appt.practitionerId) {
    const prac = await db.query.practitioner.findFirst({
      where: and(
        eq(practitioner.id, appt.practitionerId),
        eq(practitioner.organizationId, organizationId),
        notDeleted(practitioner)
      ),
      columns: { name: true },
    });
    practitionerName = prac?.name ?? null;
  }

  const { formattedDate, formattedTime } = formatDate(
    orgTimeZone,
    appt.startDate
  );

  try {
    await sendEmail({
      to: ownerMember.user.email,
      subject: `New Booking: ${clientName} — ${appt.title}`,
      template: OwnerBookingNotificationEmail,
      props: {
        ownerName: ownerMember.user.name,
        clientName,
        serviceName: appt.title,
        appointmentTitle: appt.title,
        formattedDate,
        formattedTime,
        clientEmail,
        clientPhone,
        clientNotes: appt.description,
        practitionerName,
        organizationName: orgName,
      },
    });

    return ok({ sent: true });
  } catch (error) {
    logError('appointments.notifyOwnerBooking', error, {
      feature: 'appointments',
      extra: { appointmentId, ownerEmail: ownerMember.user.email },
    });
    return ok({ sent: false, reason: 'Failed to send email' });
  }
};

export const notifyOwnerBooking = (
  db: DbConnection,
  input: NotifyOwnerBookingInput
) =>
  trackedResult(
    'appointments.notifyOwnerBooking',
    () => withOrgScope((tx) => notifyOwnerBookingImpl(tx, input), { db }),
    {
      properties: { appointmentId: input.appointmentId },
    }
  );

export type NotifyOwnerBookingServiceResult = Awaited<
  ReturnType<typeof notifyOwnerBooking>
>;
