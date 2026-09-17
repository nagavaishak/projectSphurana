import {
  type Appointment,
  appointmentSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { APPOINTMENTS_PATH_PATTERNS } from './paths.js';

interface RescheduleAppointmentOutput {
  appointmentId: string;
  appointment: Appointment;
}

interface RescheduleAppointmentInput {
  appointmentId: string;
  newStartDate: string;
  newEndDate: string;
  /** Operator can choose to send the customer a reschedule email. The
   *  underlying service handles delivery. */
  sendRescheduleEmail?: boolean;
  /** Free-text message included in the reschedule email if sent. */
  rescheduleMessage?: string;
  /** Snapshot of the original slot for the confirmation summary. */
  oldStartDate?: string;
  oldEndDate?: string;
  customerDisplayName?: string;
  serviceDisplayName?: string;
  confirmationToken?: string;
}

/**
 * `appointments_rescheduleAppointment` — move an existing appointment.
 *
 * Wraps `PUT /appointments/:id`. Two-call confirmation flow: the summary
 * shows old slot AND new slot so the operator approves with full context.
 *
 * If `sendRescheduleEmail` is true, the underlying `update-appointment`
 * service fires the existing reschedule-email pipeline (the booking system
 * handles delivery — Claire never sends emails directly).
 */
export const rescheduleAppointmentTool = defineTool<
  RescheduleAppointmentInput,
  RescheduleAppointmentOutput
>({
  feature: 'appointments',
  action: 'rescheduleAppointment',
  description:
    'Move an existing appointment to a new slot. Requires appointmentId + ' +
    'newStartDate + newEndDate (ISO). Pass sendRescheduleEmail=true to ' +
    'have the booking system notify the customer (the existing email ' +
    'pipeline handles it). Confirmation shows old AND new slots.',
  inputSchema: z.object({
    appointmentId: z.string().min(1).describe('ID of the appointment to move.'),
    newStartDate: z.string().min(1).describe('New slot start, ISO datetime.'),
    newEndDate: z.string().min(1).describe('New slot end, ISO datetime.'),
    sendRescheduleEmail: z
      .boolean()
      .optional()
      .describe(
        'When true, the booking system sends a reschedule email to the customer.'
      ),
    rescheduleMessage: z
      .string()
      .optional()
      .describe('Optional message included in the reschedule email.'),
    oldStartDate: z
      .string()
      .optional()
      .describe(
        'Original slot start (for the confirmation summary). The model should pull this from a prior listAppointments call.'
      ),
    oldEndDate: z
      .string()
      .optional()
      .describe('Original slot end (for the confirmation summary).'),
    customerDisplayName: z
      .string()
      .optional()
      .describe('Customer display name — confirmation summary only.'),
    serviceDisplayName: z
      .string()
      .optional()
      .describe('Service name — confirmation summary only.'),
    confirmationToken: z
      .string()
      .optional()
      .describe('Echoed on the second call to confirm the reschedule.'),
  }),
  destructive: true,
  destructiveAction: 'reschedule_appointment',
  preferredModel: 'sonnet',
  presentation: {
    statusLabel: 'Rescheduling',
    confirmationRenderer: 'appointment-confirmation',
  },
  additionalAllowedPaths: APPOINTMENTS_PATH_PATTERNS,
  summarizeForConfirmation: async (input) => {
    const fields: { label: string; value: string }[] = [];
    if (input.customerDisplayName) {
      fields.push({ label: 'Customer', value: input.customerDisplayName });
    }
    if (input.serviceDisplayName) {
      fields.push({ label: 'Service', value: input.serviceDisplayName });
    }
    if (input.oldStartDate) {
      fields.push({
        label: 'From',
        value: input.oldEndDate
          ? `${input.oldStartDate} → ${input.oldEndDate}`
          : input.oldStartDate,
      });
    }
    fields.push({
      label: 'To',
      value: `${input.newStartDate} → ${input.newEndDate}`,
    });
    fields.push({
      label: 'Email customer',
      value: input.sendRescheduleEmail
        ? 'Yes — booking system will send'
        : 'No',
    });
    return {
      title: 'Reschedule appointment',
      fields,
      resourceId: input.appointmentId,
      payload: {
        newStartDate: input.newStartDate,
        newEndDate: input.newEndDate,
        sendRescheduleEmail: input.sendRescheduleEmail ?? false,
      },
    };
  },
  execute: async (input, ctx) => {
    const body = {
      startDate: input.newStartDate,
      endDate: input.newEndDate,
      ...(input.sendRescheduleEmail !== undefined
        ? { sendRescheduleEmail: input.sendRescheduleEmail }
        : {}),
      ...(input.rescheduleMessage
        ? { rescheduleMessage: input.rescheduleMessage }
        : {}),
    };
    const updated = await ctx.apiFetch(`appointments/${input.appointmentId}`, {
      method: 'PUT',
      body,
      schema: appointmentSchema,
    });
    return {
      data: {
        appointmentId: updated.id,
        appointment: updated,
      },
    };
  },
});
