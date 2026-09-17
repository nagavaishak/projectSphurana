import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Cancel-inside-notice-window flow (fresha-clone guardrail). The operator
 * cancels an appointment that falls inside the org's notice window, so Claire
 * passes `lateFeeDisplay` and the confirmation surfaces the late-cancel fee.
 * Asserts the confirmation fires AND the fee is mentioned in the reply.
 */
const fixture: ClaireFixture = {
  id: 'confirmation-cancel-late-fee',
  description:
    'Manage-appointments skill: cancelling inside the notice window lands a confirmation_required for cancel_appointment and the reply flags the late-cancel fee.',
  category: 'confirmation',
  setup: { initialLoadedSkillIds: ['manage-appointments'] },
  turns: [
    {
      userMessage:
        "Cancel Emma Kelly's facial tomorrow at 10am — she rang to cancel.",
      expect: {
        confirmationPresented: 'cancel_appointment',
        responseContains: ['fee'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'cancelAppointment',
    destructive: true,
    destructiveAction: 'cancel_appointment',
    summarizeForConfirmation: (input) => ({
      title: 'Cancel appointment',
      fields: [
        {
          label: 'Customer',
          value: String(input.customerDisplayName ?? 'Emma Kelly'),
        },
        { label: 'Slot', value: String(input.slotDisplay ?? 'Tomorrow 10:00') },
        {
          label: 'Reason',
          value: String(input.reason ?? 'Customer cancelled'),
        },
        {
          label: '⚠ Late-cancel fee',
          value: `${String(
            input.lateFeeDisplay ?? '€25.00'
          )} may apply per policy (inside notice window; not charged automatically).`,
        },
      ],
      resourceId: String(input.appointmentId ?? 'appt-3'),
    }),
    respond: () => ({
      ok: true,
      data: { appointmentId: 'appt-3', status: 'cancelled' },
    }),
  },
];

export default fixture;
