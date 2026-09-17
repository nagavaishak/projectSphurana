import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'tool-dispatch-list-campaigns',
  description:
    'Manage-campaigns skill: "show me my campaigns" routes through listCampaigns (read-only) and reports each campaign with status.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['manage-campaigns'] },
  turns: [
    {
      userMessage: 'Show me my ad campaigns.',
      expect: {
        toolsCalled: ['listCampaigns'],
        responseContains: ['lip filler'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'listCampaigns',
    respond: () => ({
      ok: true,
      data: {
        campaigns: [
          {
            id: 'c-1',
            name: 'Lip filler — winter promo',
            status: 'active',
            dailyBudget: 10,
            objective: 'leads',
          },
          {
            id: 'c-2',
            name: 'Anti-wrinkle awareness',
            status: 'paused',
            dailyBudget: 8,
            objective: 'awareness',
          },
        ],
        total: 2,
      },
    }),
  },
];

export default fixture;
