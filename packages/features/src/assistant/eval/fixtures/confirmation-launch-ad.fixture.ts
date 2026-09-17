import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'confirmation-launch-ad',
  description:
    'Launch-ad flow ends with confirmLaunchAd emitting a confirmation_required presentation. The synthetic stub mirrors the factory shape.',
  category: 'confirmation',
  setup: { initialLoadedSkillIds: ['create-ad'] },
  turns: [
    {
      userMessage: 'Launch the lip-filler video ad I drafted.',
      expect: {
        confirmationPresented: 'launch_ad',
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'confirmLaunchAd',
    destructive: true,
    destructiveAction: 'launch_ad',
    summarizeForConfirmation: (input) => ({
      title: 'Launch ad',
      fields: [
        { label: 'Headline', value: 'Lip filler that suits your face' },
        { label: 'Daily budget', value: '€10' },
        { label: 'Targeting', value: '30km, ages 25–55' },
        { label: 'Destination', value: 'https://glowaesthetics.ie/book' },
      ],
      resourceId: String(input.adId ?? 'ad-1'),
    }),
    respond: () => ({ ok: true, data: { launched: true } }),
  },
];

export default fixture;
