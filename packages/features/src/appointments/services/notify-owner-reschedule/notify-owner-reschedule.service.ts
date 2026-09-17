import {
  appointment,
  lead,
  member,
  organization,
  withSystemScope,
} from '@borradh-workspace/database';
import {
  OwnerRescheduleNotificationEmail,
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
  type NotifyOwnerRescheduleInput,
  notifyOwnerRescheduleSchema,
} from './notify-owner-reschedule.schema.js';

interface NotifyOwnerRescheduleResult {
  sent: boolean;
  reason?: string;
}

/**
 * Format the appointment for the CLINIC OWNER's notification, in the BUSINESS's
 * timezone.
 *
 * `timeZone` is REQUIRED. Without it these render in the SERVER's zone — UTC in
 * production — so a 2pm Dublin appointment reached the owner as "01:00 PM".
 */
function formatDate(
  date: Date,
  timeZone: string
): {
  formattedDate: string;
  formattedTime: string;
} {
  return {
    formattedDate: date.toLocaleDateString('en-IE', {
      timeZone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    formattedTime: date.toLocaleTimeString('en-IE', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }),
  };
}

const notifyOwnerRescheduleImpl = async (
  db: DbConnection,
  input: NotifyOwnerRescheduleInput
): Promise<Result<NotifyOwnerRescheduleResult>> => {
  const parsed = notifyOwnerRescheduleSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { appointmentId, organizationId, oldStartDate } = parsed.data;

  // Clinic recipient = organization owner (organization has no email column).
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

  // Runs after the move commits, so the row now holds the NEW time.
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

  // Client (lead) details for the clinic's reference.
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

  const org = await db.query.organization.findFirst({
    where: and(eq(organization.id, organizationId), notDeleted(organization)),
    columns: { name: true, timezone: true },
  });
  const orgName = org?.name ?? 'The Team';

  const orgTimeZone = org?.timezone || 'UTC';
  const oldFormatted = formatDate(oldStartDate, orgTimeZone);
  const newFormatted = formatDate(appt.startDate, orgTimeZone);

  try {
    await sendEmail({
      to: ownerMember.user.email,
      subject: `Booking Rescheduled: ${clientName} — ${appt.title}`,
      template: OwnerRescheduleNotificationEmail,
      props: {
        ownerName: ownerMember.user.name,
        clientName,
        appointmentTitle: appt.title,
        oldFormattedDate: oldFormatted.formattedDate,
        oldFormattedTime: oldFormatted.formattedTime,
        newFormattedDate: newFormatted.formattedDate,
        newFormattedTime: newFormatted.formattedTime,
        clientEmail,
        clientPhone,
        organizationName: orgName,
      },
    });

    return ok({ sent: true });
  } catch (error) {
    logError('appointments.notifyOwnerReschedule', error, {
      feature: 'appointments',
      extra: { appointmentId, ownerEmail: ownerMember.user.email },
    });
    return ok({ sent: false, reason: 'Failed to send email' });
  }
};

/**
 * Email the clinic owner when a customer reschedules their own appointment from
 * the patient portal. Best-effort: never throws, returns `{ sent: false }` on
 * any miss so the caller can fire-and-forget. Pass the pre-move start as
 * `oldStartDate` — the appointment row already holds the new time by the time
 * this runs.
 */
export const notifyOwnerReschedule = (
  db: DbConnection,
  input: NotifyOwnerRescheduleInput
) =>
  trackedResult(
    'appointments.notifyOwnerReschedule',
    // withSystemScope, NOT withOrgScope. This runs on a request authenticated
    // by PatientAuthGuard, which sets no `activeOrganizationId` — so
    // RlsInterceptor establishes no org context, and withOrgScope fail-fasts
    // without one. With RLS on, every portal rescheduleation would therefore throw
    // in here, get swallowed by the fire-and-forget .catch at the call site,
    // and the clinic would simply never be told. Same choice mintMagicLink
    // makes on this same path.
    () => withSystemScope((tx) => notifyOwnerRescheduleImpl(tx, input), { db }),
    {
      properties: { appointmentId: input.appointmentId },
    }
  );

export type NotifyOwnerRescheduleServiceResult = Awaited<
  ReturnType<typeof notifyOwnerReschedule>
>;
