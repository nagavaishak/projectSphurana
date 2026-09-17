import { createLogger } from '@borradh-workspace/observability';
import { createAppointment } from '../../../appointments/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type BookVoiceAppointmentInput,
  bookVoiceAppointmentSchema,
} from './book-voice-appointment.schema.js';

const logger = createLogger('BookVoiceAppointment');

export interface BookVoiceAppointmentAck {
  success: true;
  appointmentId: string;
  message: string;
  appointment: {
    id: string;
    title: string;
    startDate: Date;
    endDate: Date;
    status: string;
  };
}

/**
 * Fold the voice-call metadata into the appointment description.
 *
 * THIS FORMAT IS A CONTRACT, NOT A PREFERENCE. The voice-AI integration reads
 * these lines back off the appointment, so the order, the exact labels
 * (`Customer:`, `Phone:`, `Email:`, `Voice Call ID:`), the omission of absent
 * fields, and the `\n` join are all load-bearing. It moved here verbatim from a
 * private controller helper; do not "tidy" it.
 */
const buildDescription = (input: BookVoiceAppointmentInput): string => {
  const parts: string[] = [];

  if (input.description) {
    parts.push(input.description);
  }

  parts.push(`Customer: ${input.customerName}`);

  if (input.customerPhone) {
    parts.push(`Phone: ${input.customerPhone}`);
  }

  if (input.customerEmail) {
    parts.push(`Email: ${input.customerEmail}`);
  }

  if (input.conversationId) {
    parts.push(`Voice Call ID: ${input.conversationId}`);
  }

  return parts.join('\n');
};

/**
 * `POST /integrations/voice/book` — book an appointment from a voice call.
 *
 * The entry point was doing the description assembly, the ISO-string → `Date`
 * conversion, the three fixed field choices that define "this came from the
 * voice caller" (`source`, `status`, `color`), the logging, and the ack shape.
 * All of that is this flow, so all of it lives here.
 *
 * The error Result from `createAppointment` is returned UNCHANGED — the entry
 * point maps it through the same shared `mapError` it always did, so every
 * status code is untouched.
 */
export const bookVoiceAppointment = async (
  db: DbConnection,
  input: BookVoiceAppointmentInput
): Promise<Result<BookVoiceAppointmentAck>> => {
  const parsed = bookVoiceAppointmentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const data = parsed.data;

  logger.info(
    `Voice AI booking request for organization: ${data.organizationId}`
  );
  logger.debug(`Booking details: ${JSON.stringify(input)}`);

  const result = await createAppointment(db, {
    title: data.title,
    description: buildDescription(data),
    startDate: new Date(data.startDate),
    endDate: new Date(data.endDate),
    organizationId: data.organizationId,
    leadId: data.leadId,
    assignedToId: data.assignedToId,
    source: 'ai_voice_caller',
    status: 'booked',
    color: 'blue',
  });

  if (!result.success) {
    logger.warn(
      `Voice AI booking failed: ${result.error.code} - ${result.error.message}`
    );
    return err(
      new FeatureError(
        result.error.code,
        result.error.message,
        result.error.details
      )
    );
  }

  logger.info(`Voice AI booking successful: ${result.data.id}`);

  return ok({
    success: true,
    appointmentId: result.data.id,
    message: 'Appointment booked successfully',
    appointment: {
      id: result.data.id,
      title: result.data.title,
      startDate: result.data.startDate,
      endDate: result.data.endDate,
      status: result.data.status,
    },
  });
};

export type BookVoiceAppointmentResult = Awaited<
  ReturnType<typeof bookVoiceAppointment>
>;
