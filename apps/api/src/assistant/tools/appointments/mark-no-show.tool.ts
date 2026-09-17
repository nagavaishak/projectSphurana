import {
  type Appointment,
  appointmentSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { APPOINTMENTS_PATH_PATTERNS } from './paths.js';

interface MarkNoShowOutput {
  appointmentId: string;
  status: Appointment['status'];
}

interface MarkNoShowInput {
  appointmentId: string;
  /** Optional note appended to the appointment description for audit. */
  note?: string;
  customerDisplayName?: string;
  /** Snapshot of the slot for the confirmation summary. */
  slotDisplay?: string;
  /**
   * Human-readable late/no-show fee for the confirmation summary (e.g.
   * "€25.00"). The model should pull this from the org's cancellation policy
   * when known; leave blank if the org hasn't configured one. The fee is NOT
   * auto-charged today — it's surfaced so the operator can collect manually.
   */
  lateFeeDisplay?: string;
  confirmationToken?: string;
}

/**
 * `appointments_markNoShow` — mark an appointment as a no-show.
 *
 * Wraps `PUT /appointments/:id` with `status: 'no_show'`. Two-call
 * confirmation flow (warn-and-confirm posture): marking a no-show is a
 * customer-affecting judgement call, so the operator approves first.
 *
 * Guardrail surfaced in the confirmation summary:
 *   - The slot is FREED (no_show is not an active status) — the calendar
 *     reopens that time for new bookings.
 *   - A no-show fee may apply per the org's cancellation policy. It is NOT
 *     charged automatically today; the summary flags it so the operator can
 *     collect it manually.
 *
 * Distinct from `cancelAppointment`: no-show fires NO practitioner
 * notification (the appointment simply didn't happen), so the summary must
 * not promise one.
 */
export const markNoShowTool = defineTool<MarkNoShowInput, MarkNoShowOutput>({
  feature: 'appointments',
  action: 'markNoShow',
  description:
    'Mark an appointment as a no-show (the customer did not turn up). ' +
    'Sets status to no_show, which FREES the slot for re-booking. Optional ' +
    'note is appended to the appointment for audit. A no-show fee may apply ' +
    'per the org policy but is not charged automatically. Confirmation ' +
    'required — this is a customer-affecting record.',
  inputSchema: z.object({
    appointmentId: z
      .string()
      .min(1)
      .describe('ID of the appointment to mark as a no-show.'),
    note: z
      .string()
      .optional()
      .describe(
        'Optional note appended to the appointment description for audit.'
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
        'Human-readable no-show/late fee from the org policy (e.g. "€25.00"), ' +
          'for the confirmation summary. Omit if the org has no fee configured. ' +
          'The fee is surfaced only — it is not charged automatically.'
      ),
    confirmationToken: z
      .string()
      .optional()
      .describe('Echoed on the second call to confirm the no-show.'),
  }),
  destructive: true,
  destructiveAction: 'mark_no_show',
  preferredModel: 'sonnet',
  presentation: {
    statusLabel: 'Marking no-show',
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
    // Guardrail: make the slot-reopen consequence explicit.
    fields.push({
      label: 'Effect',
      value: 'Frees the slot for re-booking; no practitioner notification.',
    });
    // Guardrail: surface the fee window honestly — it is display-only today.
    fields.push({
      label: 'No-show fee',
      value: input.lateFeeDisplay
        ? `${input.lateFeeDisplay} may apply per policy (collect manually — not auto-charged).`
        : 'Per your cancellation policy (not charged automatically).',
    });
    return {
      title: 'Mark no-show',
      fields,
      resourceId: input.appointmentId,
      payload: { note: input.note },
    };
  },
  execute: async (input, ctx) => {
    const body: Record<string, unknown> = { status: 'no_show' };
    if (input.note) {
      body.description = `No-show: ${input.note}`;
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
