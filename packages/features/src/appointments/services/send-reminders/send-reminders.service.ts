import { appointment, lead, organization } from '@borradh-workspace/database';
import { AppointmentReminderEmail, sendEmail } from '@borradh-workspace/email';
import { activeAppointmentStatuses } from '@borradh-workspace/labels';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, between, eq, inArray, isNull } from 'drizzle-orm';
import {
  formatBookingLocationAddress,
  getBookingLocationById,
} from '../../../organization-locations/index.js';
import {
  type DbConnection,
  type Result,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type SendRemindersInput,
  sendRemindersSchema,
} from './send-reminders.schema.js';

interface SendRemindersResult {
  sent24h: number;
  sent1h: number;
}

/**
 * Format an appointment instant for the CLIENT, in the BUSINESS's timezone.
 *
 * `timeZone` is a REQUIRED parameter, deliberately. Omitting the option makes
 * `toLocaleTimeString` fall back to the SERVER's zone — UTC on Fly — which told
 * a Dublin client 13:00 for a 14:00 appointment and a Californian client 16:00
 * for a 09:00 one.
 *
 * This was masked for manually-created appointments while the calendar was also
 * writing UTC: two wrongs cancelled, and the email happened to show the time
 * staff had typed. It stopped being masked the moment the stored instants were
 * corrected (2026-08-12), which is when it surfaced.
 *
 * Required rather than defaulted so a future call site cannot silently
 * reintroduce it.
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

const sendRemindersImpl = async (
  db: DbConnection,
  input: SendRemindersInput = {}
): Promise<Result<SendRemindersResult>> => {
  const parsed = sendRemindersSchema.safeParse(input);
  const batchSize = parsed.success ? parsed.data.batchSize : 50;

  const now = new Date();
  let sent24h = 0;
  let sent1h = 0;

  // 24-hour reminders: startDate between now+23h and now+25h
  const window24hStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  const window24hEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  // Wrap the window query so a transient DB failure (e.g. Neon pool blip)
  // surfaces the real cause with context and the 1h window still runs, rather
  // than throwing and getting masked as a blanket INTERNAL_ERROR (ENG-281).
  let appointments24h: (typeof appointment.$inferSelect)[] = [];
  try {
    appointments24h = await db.query.appointment.findMany({
      where: and(
        inArray(appointment.status, [...activeAppointmentStatuses]),
        notDeleted(appointment),
        isNull(appointment.reminderSentAt24h),
        between(appointment.startDate, window24hStart, window24hEnd)
      ),
      limit: batchSize,
    });
  } catch (error) {
    logError('appointments.sendReminders.24h.query', error, {
      feature: 'appointments',
      extra: { window: '24h', batchSize },
    });
  }

  for (const appt of appointments24h) {
    try {
      const leadRecord = await db.query.lead.findFirst({
        where: and(eq(lead.id, appt.leadId), notDeleted(lead)),
      });

      if (!leadRecord?.email) continue;

      const org = await db.query.organization.findFirst({
        where: and(
          eq(organization.id, appt.organizationId),
          notDeleted(organization)
        ),
        columns: { name: true, timezone: true },
      });

      // The BRANCH this appointment is at. No default-branch fallback: a NULL
      // `location_id` renders no location line rather than another branch's
      // address.
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
      const orgName = org?.name ?? 'Our Team';

      const { formattedDate, formattedTime } = formatDate(
        appt.startDate,
        org?.timezone || 'UTC'
      );

      await sendEmail({
        to: leadRecord.email,
        subject: `Reminder: ${appt.title} tomorrow`,
        template: AppointmentReminderEmail,
        props: {
          leadName,
          appointmentTitle: appt.title,
          formattedDate,
          formattedTime,
          timeUntil: '24 hours',
          organizationName: orgName,
          organizationAddress,
        },
      });

      await db
        .update(appointment)
        .set({ reminderSentAt24h: new Date() })
        .where(and(eq(appointment.id, appt.id), notDeleted(appointment)));

      sent24h++;
    } catch (error) {
      logError('appointments.sendReminders.24h', error, {
        feature: 'appointments',
        extra: { appointmentId: appt.id },
      });
    }
  }

  // 1-hour reminders: startDate between now+30min and now+90min
  const window1hStart = new Date(now.getTime() + 30 * 60 * 1000);
  const window1hEnd = new Date(now.getTime() + 90 * 60 * 1000);

  let appointments1h: (typeof appointment.$inferSelect)[] = [];
  try {
    appointments1h = await db.query.appointment.findMany({
      where: and(
        inArray(appointment.status, [...activeAppointmentStatuses]),
        notDeleted(appointment),
        isNull(appointment.reminderSentAt1h),
        between(appointment.startDate, window1hStart, window1hEnd)
      ),
      limit: batchSize,
    });
  } catch (error) {
    logError('appointments.sendReminders.1h.query', error, {
      feature: 'appointments',
      extra: { window: '1h', batchSize },
    });
  }

  for (const appt of appointments1h) {
    try {
      const leadRecord = await db.query.lead.findFirst({
        where: and(eq(lead.id, appt.leadId), notDeleted(lead)),
      });

      if (!leadRecord?.email) continue;

      const org = await db.query.organization.findFirst({
        where: and(
          eq(organization.id, appt.organizationId),
          notDeleted(organization)
        ),
        columns: { name: true, timezone: true },
      });

      // The BRANCH this appointment is at. No default-branch fallback: a NULL
      // `location_id` renders no location line rather than another branch's
      // address.
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
      const orgName = org?.name ?? 'Our Team';

      const { formattedDate, formattedTime } = formatDate(
        appt.startDate,
        org?.timezone || 'UTC'
      );

      await sendEmail({
        to: leadRecord.email,
        subject: `Reminder: ${appt.title} in 1 hour`,
        template: AppointmentReminderEmail,
        props: {
          leadName,
          appointmentTitle: appt.title,
          formattedDate,
          formattedTime,
          timeUntil: '1 hour',
          organizationName: orgName,
          organizationAddress,
        },
      });

      await db
        .update(appointment)
        .set({ reminderSentAt1h: new Date() })
        .where(and(eq(appointment.id, appt.id), notDeleted(appointment)));

      sent1h++;
    } catch (error) {
      logError('appointments.sendReminders.1h', error, {
        feature: 'appointments',
        extra: { appointmentId: appt.id },
      });
    }
  }

  return ok({ sent24h, sent1h });
};

export const sendAppointmentReminders = (
  db: DbConnection,
  input: SendRemindersInput = {}
) =>
  trackedResult(
    'appointments.sendReminders',
    () => sendRemindersImpl(db, input),
    { trackSuccess: false, trackFailure: false }
  );

export type SendRemindersServiceResult = Awaited<
  ReturnType<typeof sendAppointmentReminders>
>;
