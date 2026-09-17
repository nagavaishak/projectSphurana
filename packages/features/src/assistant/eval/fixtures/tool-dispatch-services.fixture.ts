import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'tool-dispatch-services',
  description:
    'User asks about services; Claire calls listServices and reports back.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['default'] },
  turns: [
    {
      userMessage: 'What services do I offer?',
      expect: {
        toolsCalled: ['context_listServices'],
        responseContains: ['lip filler'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'context_listServices',
    respond: () => ({
      ok: true,
      data: {
        services: [
          {
            id: 's1',
            name: 'Lip filler',
            category: 'injectables',
            description: null,
            isActive: true,
            priceText: 'From €240',
          },
          {
            id: 's2',
            name: 'Anti-wrinkle treatment',
            category: 'injectables',
            description: null,
            isActive: true,
            priceText: 'From €180',
          },
          {
            id: 's3',
            name: 'Skin booster',
            category: 'injectables',
            description: null,
            isActive: true,
            priceText: null,
          },
          {
            id: 's4',
            name: 'PRP facial',
            category: 'facials',
            description: null,
            isActive: true,
            priceText: null,
          },
        ],
        total: 4,
      },
    }),
  },
];

export default fixture;
