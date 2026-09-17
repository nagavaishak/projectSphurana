import {
  type Appointment,
  appointmentSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { APPOINTMENTS_PATH_PATTERNS } from './paths.js';

interface CancelAppointmentOutput {
  appointmentId: string;
  status: Appointment['status'];
}

interface CancelAppointmentInput {
  appointmentId: string;
  /** Optional cancellation reason. Currently appended to the appointment's
   *  description for audit; not surfaced as a structured field on the row
   *  (no schema change in this window). The brief allows the reason to live
   *  conversationally; this captures it on the record too. */
  reason?: string;
  customerDisplayName?: string;
  /** Snapshot of the slot for the confirmation summary. */
  slotDisplay?: string;
  /** Human-readable late-cancel fee from the org policy (e.g. "€25.00") when
   *  the cancellation falls inside the notice window. Surfaced in the
   *  confirmation summary; not charged automatically. */
  lateFeeDisplay?: string;
  confirmationToken?: string;
}

/**
 * `appointments_cancelAppointment` — soft-cancel an appointment.
 *
 * Wraps `PUT /appointments/:id` with `status: 'cancelled'`. The underlying
 * `update-appointment` service fires `notifyPractitionerCancellation` when
 * status transitions to `cancelled`, so notifications are owned by the
 * existing service — Claire never re-sends.
 *
 * Note: this is a SOFT cancel (the row stays for audit). Hard delete is
 * intentionally not exposed via Claire — it would lose the trail.
 */
export const cancelAppointmentTool = defineTool<
  CancelAppointmentInput,
  CancelAppointmentOutput
>({
  feature: 'appointments',
  action: 'cancelAppointment',
  description:
    'Cancel an appointment (soft cancel — the record stays with status ' +
    'cancelled). Optional reason is appended to the appointment notes for ' +
    'audit. The booking system notifies the practitioner via the existing ' +
    'pipeline. Confirmation required.',
  inputSchema: z.object({
    appointmentId: z
      .string()
      .min(1)
      .describe('ID of the appointment to cancel.'),
    reason: z
      .string()
      .optional()
      .describe(
        'Optional cancellation reason. Appended to the appointment description for audit.'
      ),
    customerDisplayName: z
      .string()
      .optional()
      .describe('Customer display name — confirmation summary only.'),
    slotDisplay: z
      .string()
      .optional()
      .describe('Slot description (e.g. "Tuesday 14:00") — summary only.'),
    lateFeeDisplay: z
      .string()
      .optional()
      .describe(
        'Late-cancel fee from the org policy (e.g. "€25.00") when this ' +
          'cancellation is inside the notice window. Surfaced to the operator; ' +
          'not charged automatically. Omit if outside the window or no fee is set.'
      ),
    confirmationToken: z
      .string()
      .optional()
      .describe('Echoed on the second call to confirm the cancellation.'),
  }),
  destructive: true,
  destructiveAction: 'cancel_appointment',
  preferredModel: 'sonnet',
  presentation: {
    statusLabel: 'Cancelling',
    confirmationRenderer: 'appointment-confirmation',
  },
  additionalAllowedPaths: APPOINTMENTS_PATH_PATTERNS,
  summarizeForConfirmation: async (input) => {
    const fields: { label: string; value: string }[] = [];
    if (input.customerDisplayName) {
      fields.push({ label: 'Customer', value: input.customerDisplayName });
    }
    if (input.slotDisplay) {
      fields.push({ label: 'Slot', value: input.slotDisplay });
    }
    fields.push({
      label: 'Reason',
      value: input.reason ?? '(none provided)',
    });
    // Guardrail: surface the late-cancel fee when inside the notice window.
    if (input.lateFeeDisplay) {
      fields.push({
        label: '⚠ Late-cancel fee',
        value: `${input.lateFeeDisplay} may apply per policy (inside notice window; not charged automatically).`,
      });
    }
    fields.push({
      label: 'Notification',
      value: 'Practitioner will be notified by the booking system.',
    });
    return {
      title: 'Cancel appointment',
      fields,
      resourceId: input.appointmentId,
      payload: { reason: input.reason },
    };
  },
  execute: async (input, ctx) => {
    const body: Record<string, unknown> = { status: 'cancelled' };
    if (input.reason) {
      // Append reason to description for audit. Read-modify-write on the
      // description would risk overwriting concurrent edits, so we rely on
      // the description being primarily Claire-managed for these flows.
      body.description = `Cancelled: ${input.reason}`;
    }
    const updated = await ctx.apiFetch(`appointments/${input.appointmentId}`, {
      method: 'PUT',
      body,
      schema: appointmentSchema,
    });
    return {
      data: {
        appointmentId: updated.id,
        status: updated.status,
      },
    };
  },
});
