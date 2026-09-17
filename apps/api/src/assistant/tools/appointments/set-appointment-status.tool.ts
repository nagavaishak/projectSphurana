import {
  type Appointment,
  appointmentSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { APPOINTMENTS_PATH_PATTERNS } from './paths.js';

interface SetAppointmentStatusOutput {
  appointmentId: string;
  status: Appointment['status'];
}

/**
 * Lifecycle statuses this tool progresses an appointment through. These are
 * low-stakes, reversible day-of transitions (front-desk check-in → in-chair →
 * done), so the tool is NON-destructive — no confirmation gate.
 *
 * The customer-affecting terminal states are deliberately EXCLUDED and owned
 * by dedicated confirmation-gated tools:
 *   - `cancelled` → `cancelAppointment`
 *   - `no_show`   → `markNoShow`
 *   - `booked`    → set at creation by `bookAppointment`
 */
const LIFECYCLE_STATUSES = [
  'confirmed',
  'arrived',
  'started',
  'completed',
] as const;

interface SetAppointmentStatusInput {
  appointmentId: string;
  status: (typeof LIFECYCLE_STATUSES)[number];
}

/**
 * `appointments_setAppointmentStatus` — progress an appointment through its
 * day-of lifecycle (confirmed → arrived → started → completed).
 *
 * Wraps `PUT /appointments/:id`. Non-destructive: these transitions are the
 * front-desk's routine check-in flow, are reversible, and don't affect the
 * customer's booking or money — so they run without a confirmation gate.
 *
 * For `no_show` use `markNoShow`; for `cancelled` use `cancelAppointment`.
 * Both of those are customer-affecting and confirmation-gated.
 */
export const setAppointmentStatusTool = defineTool<
  SetAppointmentStatusInput,
  SetAppointmentStatusOutput
>({
  feature: 'appointments',
  action: 'setAppointmentStatus',
  description:
    'Progress an appointment through its day-of lifecycle: confirmed, ' +
    'arrived, started, or completed. Use this for routine front-desk ' +
    'check-in (e.g. "mark Aoife as arrived", "the 2pm is finished"). For a ' +
    'NO-SHOW use markNoShow; to CANCEL use cancelAppointment — both need ' +
    'confirmation.',
  inputSchema: z.object({
    appointmentId: z
      .string()
      .min(1)
      .describe('ID of the appointment to update.'),
    status: z
      .enum(LIFECYCLE_STATUSES)
      .describe(
        'New lifecycle status: "confirmed" (customer confirmed attendance), ' +
          '"arrived" (checked in), "started" (in the chair), or "completed" ' +
          '(service done). Not for no_show/cancelled — use the dedicated tools.'
      ),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Updating appointment status' },
  additionalAllowedPaths: APPOINTMENTS_PATH_PATTERNS,
  execute: async (input, ctx) => {
    const updated = await ctx.apiFetch(`appointments/${input.appointmentId}`, {
      method: 'PUT',
      body: { status: input.status },
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
