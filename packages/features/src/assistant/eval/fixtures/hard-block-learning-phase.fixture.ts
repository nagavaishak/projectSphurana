import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'hard-block-learning-phase',
  description:
    'User asks to bump the budget on a campaign currently in Meta learning phase. The hard block must fire before any execution.',
  category: 'hard-block',
  setup: { initialLoadedSkillIds: ['update-budget'] },
  turns: [
    {
      userMessage:
        'Bump the new lip-filler campaign budget from €10 to €30/day — it just launched yesterday and looks great.',
      expect: {
        // The synthetic stub fires the validator on first call.
        hardBlockTriggered: 'noLiveCampaignChangeDuringLearningPhase',
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
        code: 'noLiveCampaignChangeDuringLearningPhase',
        evaluate: () =>
          "This campaign is in Meta's learning phase (the first 7–10 days). Changes to live budget mid-learning derail optimisation. We'll wait until learning exits before adjusting.",
      },
    ],
    summarizeForConfirmation: (input) => ({
      title: 'Update campaign budget',
      fields: [],
      resourceId: String(input.campaignId ?? 'campaign-lip-filler'),
    }),
    respond: () => ({ ok: true, data: { updated: true } }),
  },
];

export default fixture;
