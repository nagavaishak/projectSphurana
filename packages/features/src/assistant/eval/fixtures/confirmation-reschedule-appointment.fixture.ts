import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Reschedule flow (fresha-clone). Operator moves an existing appointment;
 * Claire finds the new slot then dispatches `rescheduleAppointment`, which is
 * destructive and lands a `confirmation_required` for `reschedule_appointment`.
 * The confirmation surfaces old AND new slot.
 */
const fixture: ClaireFixture = {
  id: 'confirmation-reschedule-appointment',
  description:
    'Manage-appointments skill: "move Aoife\'s Thursday 3pm to Friday 11am" routes through rescheduleAppointment and lands a confirmation_required for reschedule_appointment showing from/to slots.',
  category: 'confirmation',
  setup: { initialLoadedSkillIds: ['manage-appointments'] },
  turns: [
    {
      userMessage:
        "Move Aoife Murphy's lip filler from Thursday 3pm to Friday at 11am.",
      expect: {
        confirmationPresented: 'reschedule_appointment',
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'rescheduleAppointment',
    destructive: true,
    destructiveAction: 'reschedule_appointment',
    summarizeForConfirmation: (input) => ({
      title: 'Reschedule appointment',
      fields: [
        {
          label: 'Customer',
          value: String(input.customerDisplayName ?? 'Aoife Murphy'),
        },
        {
          label: 'From',
          value: String(input.oldStartDate ?? '2026-05-14T15:00:00.000Z'),
        },
        {
          label: 'To',
          value: `${String(input.newStartDate ?? '2026-05-15T11:00:00.000Z')} → ${String(
            input.newEndDate ?? '2026-05-15T11:30:00.000Z'
          )}`,
        },
      ],
      resourceId: String(input.appointmentId ?? 'appt-2'),
    }),
    respond: () => ({
      ok: true,
      data: {
        appointmentId: 'appt-2',
        appointment: {
          id: 'appt-2',
          title: 'Lip filler with Niamh',
          startDate: '2026-05-15T11:00:00.000Z',
          endDate: '2026-05-15T11:30:00.000Z',
          status: 'booked',
        },
      },
    }),
  },
];

export default fixture;
