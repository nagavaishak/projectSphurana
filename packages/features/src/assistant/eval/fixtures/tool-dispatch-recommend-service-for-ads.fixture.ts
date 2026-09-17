import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'tool-dispatch-recommend-service-for-ads',
  description:
    'Open-ended "help me run an ad" with no service named; Claire checks Meta is connected then calls recommendServiceForAds to propose what to advertise rather than guessing.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['create-ad'] },
  turns: [
    {
      userMessage: 'Help me run an ad — not sure what to promote though.',
      expect: {
        toolsCalled: ['checkMetaIntegration', 'recommendServiceForAds'],
        responseContains: ['lip filler'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'checkMetaIntegration',
    respond: () => ({
      ok: true,
      data: {
        connected: true,
        hasAdAccount: true,
        hasFacebookPage: true,
        configurationComplete: true,
      },
    }),
  },
  {
    name: 'recommendServiceForAds',
    respond: () => ({
      ok: true,
      data: {
        recommended: {
          serviceId: 's1',
          name: 'Lip filler',
          rationale:
            'Highest-margin treatment with strong existing demand and ready creative.',
        },
        alternatives: [
          { serviceId: 's2', name: 'Anti-wrinkle treatment' },
          { serviceId: 's4', name: 'PRP facial' },
        ],
      },
    }),
  },
];

export default fixture;
