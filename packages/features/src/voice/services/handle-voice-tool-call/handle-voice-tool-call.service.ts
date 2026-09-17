import { lead, organization, voiceCall } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  bookAppointment,
  checkAvailability,
} from '../../../calendar/services/index.js';
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
  type VoiceToolCallInput,
  type VoiceToolCallResult,
  bookAppointmentArgsSchema,
  checkAvailabilityArgsSchema,
  scheduleCallbackArgsSchema,
  transferToHumanArgsSchema,
  voiceToolCallSchema,
} from './handle-voice-tool-call.schema.js';
import { parseCallbackTime } from './parse-callback-time.js';

interface CallContext {
  conversationId: string;
  leadId: string | null;
  organizationId: string;
  leadRecord: typeof lead.$inferSelect | undefined;
  orgRecord: typeof organization.$inferSelect;
}

/**
 * Get call context (organization, lead) from a voice call conversation ID
 */
async function getCallContext(
  db: DbConnection,
  conversationId: string
): Promise<Result<CallContext>> {
  // Get the voice call record
  const call = await db.query.voiceCall.findFirst({
    where: eq(voiceCall.id, conversationId),
  });

  if (!call) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Voice call not found'));
  }

  // Get organization from metadata or lead
  let organizationId = call.metadata?.organizationId as string | undefined;
  let leadRecord: typeof lead.$inferSelect | undefined;

  // If no org in metadata, try to get it from the lead
  if (!organizationId && call.leadId) {
    const foundLead = await db.query.lead.findFirst({
      where: and(eq(lead.id, call.leadId), notDeleted(lead)),
    });

    if (foundLead) {
      leadRecord = foundLead;
      organizationId = foundLead.organizationId;
    }
  }

  if (!organizationId) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Could not determine organization for this call'
      )
    );
  }

  // Get organization
  const orgRecord = await db.query.organization.findFirst({
    where: and(eq(organization.id, organizationId), notDeleted(organization)),
  });

  if (!orgRecord) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
    );
  }

  return ok({
    conversationId,
    leadId: call.leadId,
    organizationId,
    leadRecord,
    orgRecord,
  });
}

/**
 * Handle check_availability tool call
 */
async function handleCheckAvailability(
  db: DbConnection,
  context: CallContext,
  args: unknown
): Promise<Record<string, unknown>> {
  const parsed = checkAvailabilityArgsSchema.safeParse(args);
  if (!parsed.success) {
    return { error: 'Invalid arguments for check_availability' };
  }

  const { date, time_preference, service_type } = parsed.data;

  // Default to today if no date provided
  const checkDate = date || new Date().toISOString().split('T')[0];

  const result = await checkAvailability(db, {
    organizationId: context.organizationId,
    date: checkDate,
    timePreference: time_preference || 'any',
    duration: context.orgRecord.defaultAppointmentDuration ?? 30,
    serviceType: service_type,
    timezone: 'UTC',
  });

  if (!result.success) {
    return {
      available: false,
      error: result.error.message,
      message:
        "I'm sorry, I couldn't check the availability right now. Would you like me to take your details and have someone call you back?",
    };
  }

  return {
    available: result.data.available,
    slots: result.data.slots,
    message: result.data.message,
  };
}

/**
 * Handle book_appointment tool call
 */
async function handleBookAppointment(
  db: DbConnection,
  context: CallContext,
  args: unknown
): Promise<Record<string, unknown>> {
  const parsed = bookAppointmentArgsSchema.safeParse(args);
  if (!parsed.success) {
    return {
      success: false,
      error: 'Invalid arguments for book_appointment',
      message:
        'I need more details to book your appointment. Could you please provide the date, time, and your contact information?',
    };
  }

  const {
    date,
    time,
    service_type,
    customer_name,
    customer_phone,
    customer_email,
    notes,
  } = parsed.data;

  // If we don't have a lead, we can't book (need to create lead first)
  if (!context.leadId) {
    return {
      success: false,
      error: 'No lead associated with this call',
      message:
        'I need to capture your details first before I can book the appointment. Let me take down your information.',
    };
  }

  // Get assigned user from lead, or we'll need to assign later
  const assignedToId = context.leadRecord?.assignedToId;

  if (!assignedToId) {
    return {
      success: false,
      error: 'No team member assigned to this lead',
      message:
        "I'm having a bit of trouble finding who should handle your appointment. Let me take down your preferred time and someone will call you back to confirm.",
    };
  }

  const result = await bookAppointment(db, {
    organizationId: context.organizationId,
    leadId: context.leadId,
    assignedToId,
    date,
    time,
    duration: context.orgRecord.defaultAppointmentDuration ?? 30,
    serviceType: service_type,
    customerName: customer_name,
    customerPhone: customer_phone,
    customerEmail: customer_email,
    notes,
    source: 'ai_voice_caller',
  });

  if (!result.success) {
    return {
      success: false,
      error: result.error.message,
      message:
        "I'm sorry, I wasn't able to book that appointment. The time slot might have just been taken. Would you like to check for other available times?",
    };
  }

  return {
    success: true,
    confirmation: result.data.confirmationCode,
    date: result.data.date,
    time: result.data.time,
    service: result.data.serviceType,
    message: result.data.message,
  };
}

/**
 * Handle schedule_callback tool call
 *
 * Schedules an AI callback at the requested time by setting `nextActionAt` on the lead.
 * Does NOT set `humanTakeoverRequested` — the sequence continues and handles the callback.
 */
async function handleScheduleCallback(
  db: DbConnection,
  context: CallContext,
  args: unknown
): Promise<Record<string, unknown>> {
  const parsed = scheduleCallbackArgsSchema.safeParse(args);
  const { preferred_time, reason } = parsed.success
    ? parsed.data
    : { preferred_time: undefined, reason: undefined };

  // Parse the callback time into a Date
  const callbackDate = preferred_time
    ? parseCallbackTime(preferred_time)
    : null;

  // Update the lead — schedule callback, don't pause the sequence
  if (context.leadId) {
    const updates: Record<string, unknown> = {
      notes: preferred_time
        ? `Callback requested for: ${preferred_time}${reason ? ` — ${reason}` : ''}`
        : `Callback requested${reason ? ` — ${reason}` : ''}`,
    };

    if (callbackDate) {
      updates.nextActionAt = callbackDate;
    }

    await db
      .update(lead)
      .set(updates)
      .where(and(eq(lead.id, context.leadId), notDeleted(lead)));
  }

  // Update voice call metadata
  await db
    .update(voiceCall)
    .set({
      callbackRequested: true,
      callbackTime: preferred_time ?? null,
    })
    .where(eq(voiceCall.id, context.conversationId));

  return {
    success: true,
    message: preferred_time
      ? `Perfect, I've scheduled a callback for ${preferred_time}. A team member will reach out to you then.`
      : "I've noted that you'd like a callback. A team member will reach out to you as soon as possible.",
  };
}

/**
 * Handle transfer_to_human tool call
 */
async function handleTransferToHuman(
  db: DbConnection,
  context: CallContext,
  args: unknown
): Promise<Record<string, unknown>> {
  const parsed = transferToHumanArgsSchema.safeParse(args);
  const { reason } = parsed.success ? parsed.data : { reason: undefined };

  // Update lead to request human takeover
  if (context.leadId) {
    await db
      .update(lead)
      .set({
        humanTakeoverRequested: true,
        humanTakeoverReason:
          reason || 'Transfer to human requested during call',
        humanTakeoverAt: new Date(),
        sequenceStatus: 'paused',
      })
      .where(and(eq(lead.id, context.leadId), notDeleted(lead)));
  }

  return {
    success: true,
    message: 'Let me transfer you to a team member who can help you better.',
  };
}

/**
 * Main implementation
 */
const handleVoiceToolCallImpl = async (
  db: DbConnection,
  input: VoiceToolCallInput
): Promise<Result<VoiceToolCallResult>> => {
  const parsed = voiceToolCallSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid tool call input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { conversation_id, tool_name, arguments: args } = parsed.data;

  // Get call context using conversation_id
  const contextResult = await getCallContext(db, conversation_id);
  if (!contextResult.success) {
    // Return a graceful error response instead of failing
    return ok({
      result: JSON.stringify({
        error: contextResult.error.message,
        message:
          "I'm having trouble accessing the system right now. Could you please hold for a moment?",
      }),
    });
  }

  const context = contextResult.data;

  try {
    let result: Record<string, unknown>;

    switch (tool_name) {
      case 'check_availability':
        result = await handleCheckAvailability(db, context, args);
        break;

      case 'book_appointment':
        result = await handleBookAppointment(db, context, args);
        break;

      case 'schedule_callback':
        result = await handleScheduleCallback(db, context, args);
        break;

      case 'transfer_to_human':
        result = await handleTransferToHuman(db, context, args);
        break;

      default:
        result = { error: `Unknown tool: ${tool_name}` };
    }

    return ok({
      result: JSON.stringify(result),
    });
  } catch (error) {
    logError('voice.handleVoiceToolCall', error, {
      feature: 'voice',
      extra: { conversationId: conversation_id, toolName: tool_name },
    });

    return ok({
      result: JSON.stringify({
        error: 'Internal error',
        message:
          "I'm sorry, I encountered an issue. Let me try that again or connect you with someone who can help.",
      }),
    });
  }
};

/**
 * Handle Telnyx AI tool calls during a live voice call
 *
 * Routes tool calls to appropriate handlers (check_availability, book_appointment, etc.)
 * and returns results in the format Telnyx expects.
 *
 * @param db - Database connection
 * @param input - Tool call input from Telnyx
 * @returns Result with tool call response
 */
export const handleVoiceToolCall = (
  db: DbConnection,
  input: VoiceToolCallInput
) =>
  trackedResult(
    'voice.handleVoiceToolCall',
    () => handleVoiceToolCallImpl(db, input),
    {
      properties: {
        toolName: input.tool_name,
        conversationId: input.conversation_id,
      },
    }
  );

export type HandleVoiceToolCallResult = Awaited<
  ReturnType<typeof handleVoiceToolCall>
>;
