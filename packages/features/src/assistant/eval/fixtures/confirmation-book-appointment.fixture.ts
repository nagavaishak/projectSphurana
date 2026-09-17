import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'confirmation-book-appointment',
  description:
    'Book-appointment flow ends with bookAppointment emitting a confirmation_required presentation. Synthetic stub mirrors the factory two-call shape and surfaces customer + slot + practitioner.',
  category: 'confirmation',
  setup: { initialLoadedSkillIds: ['manage-appointments'] },
  turns: [
    {
      userMessage:
        'Book Aoife Murphy in for the lip filler at 2pm on the 12th of May with Niamh.',
      expect: {
        confirmationPresented: 'book_appointment',
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
          value: String(input.customerDisplayName ?? 'Aoife Murphy'),
        },
        {
          label: 'Service',
          value: String(input.serviceDisplayName ?? 'Lip filler'),
        },
        {
          label: 'Practitioner',
          value: String(input.practitionerId ?? 'prac-niamh'),
        },
        {
          label: 'Start',
          value: String(input.startDate ?? '2026-05-12T14:00:00.000Z'),
        },
      ],
      resourceId: `lead:${String(input.leadId ?? 'lead-1')}@${String(
        input.startDate ?? '2026-05-12T14:00:00.000Z'
      )}`,
    }),
    respond: () => ({
      ok: true,
      data: {
        appointmentId: 'a-1',
        appointment: {
          id: 'a-1',
          title: 'Lip filler with Niamh',
          startDate: '2026-05-12T14:00:00.000Z',
          endDate: '2026-05-12T14:30:00.000Z',
          leadId: 'lead-1',
          practitionerId: 'prac-niamh',
          assignedToId: 'user-9',
          status: 'booked',
        },
      },
    }),
  },
];

export default fixture;
