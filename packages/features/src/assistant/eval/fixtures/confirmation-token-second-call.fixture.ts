import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'confirmation-token-second-call',
  description:
    'Two-turn flow: first turn issues a confirmation token; second turn echoes the token back and the destructive action executes. Mirrors the factory two-call confirmation pattern.',
  category: 'confirmation',
  setup: { initialLoadedSkillIds: ['create-ad'] },
  turns: [
    {
      userMessage: 'Launch the ad.',
      expect: {
        confirmationPresented: 'launch_ad',
      },
    },
    {
      userMessage: 'Yes, go ahead.',
      expect: {
        // The recording feeds the model a tool_result with a token; the
        // model echoes it back to executeLaunchAd. This trace asserts
        // the full round-trip.
        toolsCalled: ['executeLaunchAd'],
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
      fields: [{ label: 'Headline', value: 'Lip filler that suits your face' }],
      resourceId: String(input.adId ?? 'ad-1'),
    }),
    respond: () => ({ ok: true, data: { launched: true } }),
  },
  {
    name: 'executeLaunchAd',
    destructive: true,
    destructiveAction: 'launch_ad',
    summarizeForConfirmation: (input) => ({
      title: 'Launch ad (execute)',
      fields: [],
      resourceId: String(input.adId ?? 'ad-1'),
    }),
    respond: () => ({ ok: true, data: { launched: true, adId: 'ad-1' } }),
  },
];

export default fixture;
