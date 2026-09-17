import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'tool-dispatch-budget',
  description:
    'Update-budget skill exercises confirmUpdateBudget → executeUpdateBudget. Verifies the destructive-confirm flow plus telemetry.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['update-budget'] },
  turns: [
    {
      userMessage:
        'Increase the lip filler campaign budget from €10 to €15 per day.',
      expect: {
        toolsCalled: ['confirmUpdateBudget'],
        confirmationPresented: 'update_budget',
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'confirmUpdateBudget',
    destructive: true,
    destructiveAction: 'update_budget',
    summarizeForConfirmation: (input) => ({
      title: 'Update campaign budget',
      fields: [
        {
          label: 'Campaign',
          value: String(input.campaignId ?? 'lip filler campaign'),
        },
        { label: 'Current daily budget', value: '€10' },
        { label: 'New daily budget', value: '€15' },
      ],
      resourceId: String(input.campaignId ?? 'campaign-lip-filler'),
    }),
    respond: () => ({
      ok: true,
      data: { updated: true },
    }),
  },
  {
    name: 'executeUpdateBudget',
    destructive: true,
    destructiveAction: 'update_budget',
    summarizeForConfirmation: (input) => ({
      title: 'Update campaign budget',
      fields: [],
      resourceId: String(input.campaignId ?? 'campaign-lip-filler'),
    }),
    respond: () => ({
      ok: true,
      data: { updated: true, newDailyBudget: '€15' },
    }),
  },
];

export default fixture;
