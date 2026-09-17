import {
  appointment,
  appointmentDeposit,
  lead,
  organizationService,
  practitioner,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { sendPushNotification } from '../../../notifications/services/send-push-notification/send-push-notification.service.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  formatInOrgZone,
  ok,
} from '../../../shared/index.js';
import {
  type NotifyDepositPaidInput,
  notifyDepositPaidSchema,
} from './notify-deposit-paid.schema.js';

interface NotifyDepositPaidResult {
  notified: boolean;
  reason?: string;
}

/**
 * Format a minor-unit amount (cents) as a currency string, e.g. 2500/'gbp' →
 * "£25". Falls back to the upper-cased currency code for unknown currencies.
 */
function formatAmount(amountCents: number, currency: string): string {
  const symbols: Record<string, string> = {
    gbp: '£',
    eur: '€',
    usd: '$',
  };
  const symbol = symbols[currency.toLowerCase()];
  const major = amountCents / 100;
  const value = Number.isInteger(major) ? String(major) : major.toFixed(2);
  return symbol ? `${symbol}${value}` : `${value} ${currency.toUpperCase()}`;
}

/**
 * Notify the clinic when a booking deposit has been paid.
 *
 * Sends a push notification to the organization owner (and the assigned
 * practitioner, if any) in the form:
 *   "[Name] booked [Service] on [Date] — £25 deposit paid"
 *
 * Fire-and-forget: failures are logged but never surfaced to the webhook.
 */
const notifyDepositPaidImpl = async (
  db: DbConnection,
  input: NotifyDepositPaidInput
): Promise<Result<NotifyDepositPaidResult>> => {
  const parsed = notifyDepositPaidSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { depositId } = parsed.data;

  const deposit = await db.query.appointmentDeposit.findFirst({
    where: eq(appointmentDeposit.id, depositId),
  });

  if (!deposit) {
    return ok({ notified: false, reason: 'Deposit not found' });
  }

  const appt = await db.query.appointment.findFirst({
    where: eq(appointment.id, deposit.appointmentId),
  });

  if (!appt) {
    return ok({ notified: false, reason: 'Appointment not found' });
  }

  // Client name
  let clientName = 'A client';
  if (appt.leadId) {
    const leadRecord = await db.query.lead.findFirst({
      where: eq(lead.id, appt.leadId),
      columns: { firstName: true, lastName: true },
    });
    if (leadRecord) {
      clientName =
        `${leadRecord.firstName ?? ''} ${leadRecord.lastName ?? ''}`.trim() ||
        clientName;
    }
  }

  // Service name (fall back to the appointment title, which embeds it)
  let serviceName = appt.title;
  if (appt.serviceId) {
    const svc = await db.query.organizationService.findFirst({
      where: eq(organizationService.id, appt.serviceId),
      columns: { name: true },
    });
    if (svc?.name) serviceName = svc.name;
  }

  // `appt.startDate` is a UTC instant, so naming the DAY it falls on requires
  // knowing the clinic's zone. Being date-only is the reason to load the org,
  // not a reason to skip it: an unzoned render is wrong for exactly the
  // appointments at either end of the working day, and it is wrong by a whole
  // day rather than by an obviously-odd clock face. A 9am Auckland appointment
  // is 20:00Z the day BEFORE, so every morning booking would reach the clinic's
  // phone labelled with yesterday's date. One indexed lookup by a key already
  // in hand, alongside the four this service already runs, is a cheap price.
  const org = await db.query.organization.findFirst({
    where: (o, { eq: eqOp }) => eqOp(o.id, deposit.organizationId),
    columns: { timezone: true },
  });

  const formattedDate = formatInOrgZone(
    org?.timezone ?? 'UTC',
    appt.startDate,
    { weekday: 'long', month: 'long', day: 'numeric' },
    'en-IE'
  );

  const amount = formatAmount(deposit.amountCents, deposit.currency);
  const title = 'Deposit paid';
  const body = `${clientName} booked ${serviceName} on ${formattedDate} — ${amount} deposit paid`;

  // Collect target users: org owner + assigned practitioner.
  const targetUserIds = new Set<string>();

  const ownerMember = await db.query.member.findFirst({
    where: (t, { and, eq: eqOp }) =>
      and(
        eqOp(t.organizationId, deposit.organizationId),
        eqOp(t.role, 'owner')
      ),
    columns: { userId: true },
  });
  if (ownerMember?.userId) targetUserIds.add(ownerMember.userId);

  if (appt.practitionerId) {
    const prac = await db.query.practitioner.findFirst({
      where: eq(practitioner.id, appt.practitionerId),
      columns: { userId: true },
    });
    if (prac?.userId) targetUserIds.add(prac.userId);
  }

  if (targetUserIds.size === 0) {
    return ok({ notified: false, reason: 'No clinic users to notify' });
  }

  let notified = false;
  for (const userId of targetUserIds) {
    try {
      // sendPushNotification returns a Result and does not throw, so the
      // catch below never sees a delivery failure — check the Result, or
      // `notified: true` would be reported for sends that all failed.
      const pushResult = await sendPushNotification(db, {
        userId,
        title,
        body,
        data: { screen: 'appointments', appointmentId: appt.id },
      });
      if (pushResult.success) notified = true;
    } catch (error) {
      logError('appointments.notifyDepositPaid', error, {
        feature: 'appointments',
        extra: { depositId, userId },
      });
    }
  }

  return ok({ notified });
};

export const notifyDepositPaid = (
  db: DbConnection,
  input: NotifyDepositPaidInput
) =>
  trackedResult(
    'appointments.notifyDepositPaid',
    () => notifyDepositPaidImpl(db, input),
    {
      properties: {
        depositId: input.depositId,
      },
      internalErrorsOnly: true,
    }
  );

export type NotifyDepositPaidServiceResult = Awaited<
  ReturnType<typeof notifyDepositPaid>
>;
