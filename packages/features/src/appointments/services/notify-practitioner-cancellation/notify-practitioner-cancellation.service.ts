import {
  appointment,
  lead,
  organization,
  practitioner,
  withOrgScope,
} from '@borradh-workspace/database';
import {
  PractitionerCancellationNotificationEmail,
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
  type NotifyPractitionerCancellationInput,
  notifyPractitionerCancellationSchema,
} from './notify-practitioner-cancellation.schema.js';

interface NotifyPractitionerCancellationResult {
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

const notifyPractitionerCancellationImpl = async (
  db: DbConnection,
  input: NotifyPractitionerCancellationInput
): Promise<Result<NotifyPractitionerCancellationResult>> => {
  const parsed = notifyPractitionerCancellationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { appointmentId, organizationId, cancellationReason } = parsed.data;

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

  if (appt.leadId) {
    const leadRecord = await db.query.lead.findFirst({
      where: and(eq(lead.id, appt.leadId), notDeleted(lead)),
    });

    if (leadRecord) {
      clientName =
        `${leadRecord.firstName ?? ''} ${leadRecord.lastName ?? ''}`.trim() ||
        'A customer';
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
      subject: `Booking Cancelled: ${clientName} — ${appt.title}`,
      template: PractitionerCancellationNotificationEmail,
      props: {
        practitionerName: prac.name,
        clientName,
        serviceName: null,
        appointmentTitle: appt.title,
        formattedDate,
        formattedTime,
        cancellationReason: cancellationReason ?? null,
        organizationName: orgName,
      },
    });

    return ok({ sent: true });
  } catch (error) {
    logError('appointments.notifyPractitionerCancellation', error, {
      feature: 'appointments',
      extra: { appointmentId, practitionerEmail: prac.email },
    });
    return ok({ sent: false, reason: 'Failed to send email' });
  }
};

export const notifyPractitionerCancellation = (
  db: DbConnection,
  input: NotifyPractitionerCancellationInput
) =>
  trackedResult(
    'appointments.notifyPractitionerCancellation',
    () =>
      withOrgScope((tx) => notifyPractitionerCancellationImpl(tx, input), {
        db,
      }),
    {
      properties: { appointmentId: input.appointmentId },
    }
  );

export type NotifyPractitionerCancellationServiceResult = Awaited<
  ReturnType<typeof notifyPractitionerCancellation>
>;
