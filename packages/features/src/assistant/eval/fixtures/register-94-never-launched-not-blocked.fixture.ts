import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Register #94 — the learning-phase block fired on a campaign that had never
 * launched (created PAUSED, zero delivery). The learning-status service now
 * gates `isInLearningPhase` on ACTUAL delivery, so a never-delivered campaign
 * is not in learning and its budget can be changed freely.
 *
 * This fixture pins that: a budget change on a fresh, never-launched campaign
 * proceeds to the approval step — no learning-phase refusal.
 *
 * `org`/`quote` fields are stripped per the audit README rule.
 */
const fixture: ClaireFixture = {
  id: 'register-94-never-launched-not-blocked',
  description:
    'A budget change on a never-launched (zero-delivery) campaign is not blocked by the learning-phase gate.',
  category: 'hard-block',
  setup: { initialLoadedSkillIds: ['create-ad'] },
  turns: [
    {
      userMessage:
        'Bump the daily budget on the new lip-filler campaign I just made up to $30.',
      expect: {
        toolsCalled: ['confirmUpdateBudget'],
        responseContains: ['$30'],
        responseLacks: [
          'learning phase',
          "can't change",
          'resets the algorithm',
          'wait until day',
        ],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'confirmUpdateBudget',
    respond: () => ({
      ok: true,
      data: {
        state: 'awaiting_approval',
        metaCampaignId: 'mc-1',
        requestedBudget: '$30.00/day',
        confirmationToken: 'tok',
      },
    }),
  },
];

export default fixture;
