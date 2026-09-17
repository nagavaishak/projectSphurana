import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'hard-block-discount-below-cost',
  description:
    'User asks for a 90% discount on lip filler. The synthetic stub fires noDiscountBelowCost; the live validator is stubbed pending C-08 service-cost wiring.',
  category: 'hard-block',
  setup: { initialLoadedSkillIds: ['default'] },
  turns: [
    {
      userMessage:
        'Make me a 90% off lip filler offer for tomorrow only — €24 instead of €240.',
      expect: {
        hardBlockTriggered: 'noDiscountBelowCost',
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'createOffer',
    destructive: true,
    destructiveAction: 'create_offer',
    hardBlockChecks: [
      {
        code: 'noDiscountBelowCost',
        evaluate: (input) => {
          const blob = JSON.stringify(input);
          if (/9[0-9]\s*%/.test(blob) || /\b9[0-9]%\s*off/.test(blob)) {
            return 'A 90% discount on injectables prices below cost. We can run a small promotional discount, but not at this depth.';
          }
          return null;
        },
      },
    ],
    summarizeForConfirmation: (input) => ({
      title: 'Create offer',
      fields: [],
      resourceId: String(input.serviceId ?? 'service-lip-filler'),
    }),
    respond: () => ({ ok: true, data: { created: true } }),
  },
];

export default fixture;
