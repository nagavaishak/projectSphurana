import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'classifier-ad-optimisation',
  description:
    'Classifier routes "review my ad performance" to the optimise-ads skill.',
  category: 'classifier',
  // No initialLoadedSkillIds — we want the classifier to fire.
  turns: [
    {
      userMessage: 'Can you review my ad performance this week?',
      expect: {
        skillsLoaded: ['optimise-ads'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  // The recording for this fixture stops at one round with no tool calls
  // (the model acknowledges and waits for follow-up). Real Anthropic in
  // record mode would likely call `checkMetaIntegration` or similar; the
  // recording captures whatever happens.
];

export default fixture;
