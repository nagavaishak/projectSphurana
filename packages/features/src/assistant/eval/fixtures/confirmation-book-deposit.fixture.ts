import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Book-a-deposit-service flow (fresha-clone guardrail). The booked service
 * requires a deposit; Claire's booking confirmation surfaces that the customer
 * will be sent a payment link. Asserts the confirmation fires AND the reply
 * mentions the deposit/payment link.
 */
const fixture: ClaireFixture = {
  id: 'confirmation-book-deposit',
  description:
    'Manage-appointments skill: booking a deposit-required service lands a confirmation_required for book_appointment and the reply flags the deposit payment link.',
  category: 'confirmation',
  setup: { initialLoadedSkillIds: ['manage-appointments'] },
  turns: [
    {
      userMessage:
        'Book Chloe Barrett in for the Profhilo on Monday at 2pm with Niamh — that one needs a deposit.',
      expect: {
        confirmationPresented: 'book_appointment',
        responseContains: ['deposit'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'bookAppointment',
    destructive: true,
    destructiveAction: 'book_appointment',
    summarizeForConfirmation: (input) => ({
      title: 'Book appointment',
      fields: [
        {
          label: 'Customer',
          value: String(input.customerDisplayName ?? 'Chloe Barrett'),
        },
        {
          label: 'Service',
          value: String(input.serviceDisplayName ?? 'Profhilo'),
        },
        {
          label: 'Start',
          value: String(input.startDate ?? '2026-05-18T13:00:00.000Z'),
        },
        {
          label: 'Deposit',
          value:
            'Required — the customer will receive a payment link from the booking system.',
        },
      ],
      resourceId: String(input.leadId ?? 'lead-chloe'),
    }),
    respond: () => ({
      ok: true,
      data: {
        appointmentId: 'appt-4',
        appointment: {
          id: 'appt-4',
          title: 'Profhilo with Niamh',
          startDate: '2026-05-18T13:00:00.000Z',
          endDate: '2026-05-18T13:45:00.000Z',
          leadId: 'lead-chloe',
          practitionerId: 'prac-niamh',
          assignedToId: 'user-9',
          status: 'booked',
        },
      },
    }),
  },
];

export default fixture;
