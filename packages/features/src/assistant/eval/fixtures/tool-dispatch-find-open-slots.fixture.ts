import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'tool-dispatch-find-open-slots',
  description:
    'Manage-appointments skill: "when can I fit a client in?" routes through findOpenSlots (read-only availability lookup) and surfaces concrete open times rather than booking anything.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['manage-appointments'] },
  turns: [
    {
      userMessage: 'When could I fit a new client in for lip filler this week?',
      expect: {
        toolsCalled: ['findOpenSlots'],
        responseContains: ['slot'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'findOpenSlots',
    respond: () => ({
      ok: true,
      data: {
        serviceName: 'Lip filler',
        slots: [
          {
            start: '2026-05-13T10:00:00.000Z',
            end: '2026-05-13T10:45:00.000Z',
            practitionerLabel: 'Niamh',
          },
          {
            start: '2026-05-14T15:30:00.000Z',
            end: '2026-05-14T16:15:00.000Z',
            practitionerLabel: 'Aoife',
          },
        ],
        totalFound: 2,
      },
    }),
  },
];

export default fixture;
