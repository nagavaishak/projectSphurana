import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'tool-dispatch-list-offers',
  description:
    'Manage-offers skill: "what offers do I have running?" routes through listOffers (read-only, no confirmation) and reports active offers.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['manage-offers'] },
  turns: [
    {
      userMessage: 'What offers do I have running right now?',
      expect: {
        toolsCalled: ['listOffers'],
        responseContains: ['lip filler'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'listOffers',
    respond: () => ({
      ok: true,
      data: {
        offers: [
          {
            id: 'offer-1',
            serviceName: 'Lip filler',
            discount: '15%',
            validUntil: '2026-05-09',
            isActive: true,
          },
          {
            id: 'offer-2',
            serviceName: 'Skin booster',
            discount: '€30 off',
            validUntil: '2026-05-01',
            isActive: true,
          },
        ],
        total: 2,
      },
    }),
  },
];

export default fixture;
