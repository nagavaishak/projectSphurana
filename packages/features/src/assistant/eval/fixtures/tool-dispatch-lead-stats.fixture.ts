import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'tool-dispatch-lead-stats',
  description:
    'Manage-leads skill loaded; an operator asks for the org-wide pipeline state so the model dispatches `getLeadStats` (per skill rule: page counts come from listLeads, totals come from getLeadStats).',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['manage-leads'] },
  turns: [
    {
      userMessage: 'How are my leads doing overall?',
      expect: {
        toolsCalled: ['getLeadStats'],
        responseContains: ['lead'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'getLeadStats',
    respond: () => ({
      ok: true,
      data: {
        totalLeads: 124,
        newLeads: 38,
        contactedLeads: 41,
        bookedLeads: 11,
        lostLeads: 3,
        conversionRate: 8.9,
      },
    }),
  },
];

export default fixture;
