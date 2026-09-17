import {
  appointment,
  conversation,
  lead,
  organization,
} from '@borradh-workspace/database';
import type { ConversationMetadata } from '@borradh-workspace/database';
import { activeAppointmentStatuses } from '@borradh-workspace/labels';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, gt, inArray } from 'drizzle-orm';
import { checkAvailability } from '../../../calendar/services/check-availability/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type EvaluateReschedulePolicyInput,
  type RescheduleEvaluation,
  evaluateReschedulePolicySchema,
} from './evaluate-reschedule-policy.schema.js';

const BORRADH_MANAGED_CALENDARS = new Set([
  'borradh',
  'google_calendar',
  'calendly',
  'timely',
]);

const evaluateReschedulePolicyImpl = async (
  db: DbConnection,
  input: EvaluateReschedulePolicyInput
): Promise<Result<RescheduleEvaluation>> => {
  const parsed = evaluateReschedulePolicySchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, conversationId } = parsed.data;

  try {
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
      columns: {
        id: true,
        timezone: true,
        primaryCalendarType: true,
        reschedulingNoticeRequiredHours: true,
        noShowOrLateCancelFeeCents: true,
      },
    });

    if (!org) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
      );
    }

    // Format an appointment instant in the org's timezone (the single source of
    // truth for wall-clock times on this branch — not server-local).
    const formatApptTime = (date: Date) =>
      date.toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: org.timezone,
      });

    const conv = await db.query.conversation.findFirst({
      where: eq(conversation.id, conversationId),
      columns: { metadata: true },
    });

    if (!conv) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Conversation not found')
      );
    }

    const meta = conv.metadata as ConversationMetadata | null;
    const phone = meta?.phone;
    const name = meta?.name;

    if (!phone && !name) {
      return ok({
        eligible: false,
        reason: 'no_contact_info',
        contextMessage:
          'I need your name or phone number to look up your appointment. Could you share those details?',
      });
    }

    // Find the lead by phone or name match within the org
    const conditions = [eq(lead.organizationId, organizationId)];
    if (phone) {
      conditions.push(eq(lead.phone, phone));
    }

    const matchedLead = await db.query.lead.findFirst({
      where: and(...conditions),
      columns: { id: true, firstName: true, lastName: true },
    });

    if (!matchedLead) {
      return ok({
        eligible: false,
        reason: 'no_lead_found',
        contextMessage:
          "I couldn't find your booking record. Could you confirm the phone number you booked with?",
      });
    }

    // Find the next upcoming active appointment for this lead. On this branch
    // the appointment-status enum is booked/confirmed/arrived/started/... — the
    // old 'scheduled' literal no longer exists; `activeAppointmentStatuses` is
    // the branch-wide set of "live" statuses (booked/confirmed/arrived/started).
    const upcomingAppointment = await db.query.appointment.findFirst({
      where: and(
        eq(appointment.leadId, matchedLead.id),
        eq(appointment.organizationId, organizationId),
        inArray(appointment.status, [...activeAppointmentStatuses]),
        gt(appointment.startDate, new Date())
      ),
      orderBy: (apt, { asc }) => [asc(apt.startDate)],
      columns: {
        id: true,
        title: true,
        startDate: true,
        endDate: true,
      },
    });

    if (!upcomingAppointment) {
      return ok({
        eligible: false,
        reason: 'no_upcoming_appointment',
        contextMessage:
          "I don't see any upcoming appointments for you. Would you like to book a new appointment?",
      });
    }

    // Check if the calendar is Borradh-managed
    const calType = org.primaryCalendarType;
    if (!calType || !BORRADH_MANAGED_CALENDARS.has(calType)) {
      return ok({
        eligible: false,
        reason: 'external_provider',
        appointmentId: upcomingAppointment.id,
        appointmentTitle: upcomingAppointment.title,
        appointmentStartDate: upcomingAppointment.startDate.toISOString(),
        contextMessage:
          'This appointment is managed through an external booking system. Let me connect you with a team member who can help reschedule.',
      });
    }

    // Evaluate notice window
    const noticeHours = org.reschedulingNoticeRequiredHours ?? 24;
    const noShowFeeCents = org.noShowOrLateCancelFeeCents ?? null;
    const hoursUntilAppointment =
      (upcomingAppointment.startDate.getTime() - Date.now()) / (1000 * 60 * 60);

    if (hoursUntilAppointment < noticeHours) {
      const feeText =
        noShowFeeCents != null && noShowFeeCents > 0
          ? ` A late cancellation fee of £${(noShowFeeCents / 100).toFixed(2)} may apply.`
          : '';

      return ok({
        eligible: false,
        reason: 'inside_notice_window',
        appointmentId: upcomingAppointment.id,
        appointmentTitle: upcomingAppointment.title,
        appointmentStartDate: upcomingAppointment.startDate.toISOString(),
        noticeRequiredHours: noticeHours,
        noShowFeeCents,
        contextMessage: `Unfortunately we need ${noticeHours} hours notice to reschedule.${feeText} Your current appointment is on ${formatApptTime(upcomingAppointment.startDate)}. Would you like to keep your current appointment?`,
      });
    }

    // Eligible! Fetch available slots for the next few days
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

    let availableSlots: { displayTime: string; date: string }[] = [];
    const availResult = await checkAvailability(db, {
      organizationId,
      date: dateStr,
      timePreference: 'any',
      timezone: org.timezone,
    });

    if (availResult.success) {
      availableSlots = availResult.data.slots.slice(0, 3).map((s) => ({
        displayTime: s.displayTime,
        date: s.date,
      }));
    }

    const slotsText =
      availableSlots.length > 0
        ? availableSlots.map((s) => `${s.displayTime} (${s.date})`).join(', ')
        : 'No slots available tomorrow — ask the client for a preferred day.';

    return ok({
      eligible: true,
      reason: 'eligible',
      appointmentId: upcomingAppointment.id,
      appointmentTitle: upcomingAppointment.title,
      appointmentStartDate: upcomingAppointment.startDate.toISOString(),
      appointmentEndDate: upcomingAppointment.endDate.toISOString(),
      noticeRequiredHours: noticeHours,
      noShowFeeCents,
      availableSlots,
      contextMessage: `The client's current appointment "${upcomingAppointment.title}" is on ${formatApptTime(upcomingAppointment.startDate)}. They are eligible to reschedule. Available slots: ${slotsText}. Offer 3 options and ask which suits them.`,
    });
  } catch (error) {
    logError('chatbots.evaluateReschedulePolicy', error, {
      feature: 'chatbots',
      extra: { organizationId, conversationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to evaluate reschedule policy'
      )
    );
  }
};

export const evaluateReschedulePolicy = (
  db: DbConnection,
  input: EvaluateReschedulePolicyInput
) =>
  trackedResult(
    'chatbots.evaluateReschedulePolicy',
    () => evaluateReschedulePolicyImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
      },
    }
  );

export type EvaluateReschedulePolicyResult = Awaited<
  ReturnType<typeof evaluateReschedulePolicy>
>;
