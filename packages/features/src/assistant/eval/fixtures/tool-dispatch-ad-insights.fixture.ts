import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'tool-dispatch-ad-insights',
  description:
    'Optimise-ads skill: "how are my ads doing?" routes through listRecentAds then getAdInsights; the answer reports real spend/CPL numbers from the tool result, never fabricated.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['optimise-ads'] },
  turns: [
    {
      userMessage: 'How are my ads doing this week?',
      expect: {
        toolsCalled: ['listRecentAds', 'getAdInsights'],
        responseContains: ['cost per lead'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'listRecentAds',
    respond: () => ({
      ok: true,
      data: {
        ads: [
          {
            id: 'ad-1',
            name: 'Lip filler — winter promo',
            status: 'active',
            campaignId: 'c-1',
          },
        ],
      },
    }),
  },
  {
    name: 'getAdInsights',
    respond: () => ({
      ok: true,
      data: {
        adId: 'ad-1',
        window: 'last_7d',
        spend: 70,
        impressions: 9120,
        clicks: 188,
        leads: 9,
        costPerLead: 7.78,
        learningPhase: false,
      },
    }),
  },
];

export default fixture;
