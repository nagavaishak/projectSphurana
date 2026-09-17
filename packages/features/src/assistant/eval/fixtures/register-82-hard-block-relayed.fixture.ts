import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Register #82 — the learning-phase budget block must be RELAYED to the owner,
 * never swallowed. In the audit, Claire hit the learning-phase hard block on a
 * budget change and then reported success anyway (and the card still showed the
 * owner's requested figure, not the one that ran — the model-authored
 * `budgetDisplay` defect fixed server-side in the same phase).
 *
 * This fixture pins the relay half: a `hard_block_violation` presentation must
 * always be verbalised, and Claire must NOT claim the budget was changed.
 *
 * `org`/`quote` fields are stripped per the audit README rule.
 */
const fixture: ClaireFixture = {
  id: 'register-82-hard-block-relayed',
  description:
    'A learning-phase budget block (hard_block_violation) is verbalised to the owner and NOT reported as a successful change.',
  category: 'hard-block',
  setup: { initialLoadedSkillIds: ['create-ad'] },
  turns: [
    {
      userMessage:
        'Bump the daily budget on the winter campaign up to $40 a day.',
      expect: {
        toolsCalled: ['confirmUpdateBudget'],
        hardBlockTriggered: 'noScalingBeforeLearningExits',
        responseContains: ['learning phase'],
        responseLacks: [
          'budget is now',
          'increased to',
          'updated to',
          'set to $40',
          'all set',
        ],
        toolFailed: {
          name: 'confirmUpdateBudget',
          code: 'noScalingBeforeLearningExits',
        },
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'confirmUpdateBudget',
    destructive: true,
    destructiveAction: 'update_budget',
    hardBlockChecks: [
      {
        code: 'noScalingBeforeLearningExits',
        evaluate: () =>
          "That campaign is still in Meta's learning phase (day 4 of 10). Scaling it now resets the algorithm — let's wait until day 10 and revisit.",
      },
    ],
    summarizeForConfirmation: (input) => ({
      title: 'Update daily budget',
      resourceId: String(input.metaCampaignId ?? 'campaign'),
    }),
    respond: () => ({
      ok: false,
      error:
        "That campaign is still in Meta's learning phase (day 4 of 10). Scaling it now resets the algorithm.",
      code: 'noScalingBeforeLearningExits',
    }),
  },
];

export default fixture;
