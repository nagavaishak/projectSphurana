import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'tool-dispatch-appointments',
  description:
    'Manage-appointments skill (W-C07): a "what does today look like" question routes through summariseUpcomingDay; the response surfaces day counts.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['manage-appointments'] },
  turns: [
    {
      userMessage: "What's on my appointment book today?",
      expect: {
        toolsCalled: ['summariseUpcomingDay'],
        responseContains: ['appointment'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'summariseUpcomingDay',
    respond: () => ({
      ok: true,
      data: {
        date: '2026-05-12',
        totalScheduled: 4,
        totalCancelled: 1,
        totalCompleted: 0,
        totalNoShow: 0,
        byPractitioner: [
          {
            practitionerLabel: 'Niamh',
            appointmentCount: 3,
            earliest: '2026-05-12T09:00:00.000Z',
            latest: '2026-05-12T13:30:00.000Z',
          },
          {
            practitionerLabel: 'Aoife',
            appointmentCount: 1,
            earliest: '2026-05-12T11:00:00.000Z',
            latest: '2026-05-12T11:30:00.000Z',
          },
        ],
        upcoming: [],
      },
    }),
  },
];

export default fixture;
