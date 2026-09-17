import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'tool-dispatch-leads-summary',
  description:
    "Manage-leads skill loaded; the operator asks 'how are leads doing this month' so the model picks `summariseRecentLeads` for the rollup rather than `listLeads` (per the skill prompt fragment).",
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['manage-leads'] },
  turns: [
    {
      userMessage: 'Summarise my leads this month.',
      expect: {
        toolsCalled: ['summariseRecentLeads'],
        responseContains: ['lead'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'summariseRecentLeads',
    respond: () => ({
      ok: true,
      data: {
        timeframe: 'month',
        windowStart: '2026-03-25T00:00:00.000Z',
        windowEnd: '2026-04-25T00:00:00.000Z',
        totalLeads: 42,
        previousLeads: 28,
        deltaPercent: 50,
        byStatus: {
          new: 18,
          contacted: 14,
          qualified: 7,
          won: 2,
          lost: 1,
        },
        bySource: { facebook: 30, instagram: 8, website: 4 },
        topLeads: [
          {
            id: 'lead-9',
            firstName: 'Niamh',
            lastName: 'Doyle',
            email: 'niamh@example.com',
            phone: null,
            status: 'contacted',
            source: 'facebook',
            createdAt: '2026-04-23T09:30:00.000Z',
          },
        ],
      },
    }),
  },
];

export default fixture;
