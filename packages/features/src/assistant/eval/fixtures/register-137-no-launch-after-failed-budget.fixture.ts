import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Register #137 — a budget change FAILED and Claire launched the ad anyway, at
 * the old budget. The money-truth interlock now holds the launch
 * (`blocked: unacknowledged_budget_failure`) until the owner explicitly says to
 * go ahead. This fixture pins the behaviour: after a failed budget update,
 * Claire must NOT report the ad as live.
 *
 * `org`/`quote` fields are stripped per the audit README rule.
 */
const fixture: ClaireFixture = {
  id: 'register-137-no-launch-after-failed-budget',
  description:
    'After a failed budget change, the launch is held (unacknowledged_budget_failure) and the ad is never reported live.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['create-ad'] },
  turns: [
    {
      userMessage:
        'Set the winter campaign budget to $50 a day, then launch the lip-filler ad.',
      expect: {
        toolsCalled: ['executeUpdateBudget', 'executeLaunchAd'],
        toolFailed: { name: 'executeUpdateBudget' },
        responseContains: ['budget', 'old budget'],
        responseLacks: [
          'is live',
          'now live',
          'going live',
          'launched successfully',
          'all set',
        ],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'executeUpdateBudget',
    respond: () => ({
      ok: false,
      error: "That budget change didn't go through — Meta rejected it.",
    }),
  },
  {
    name: 'executeLaunchAd',
    respond: () => ({
      ok: true,
      data: {
        blocked: 'unacknowledged_budget_failure',
        error:
          "I'm holding this launch: the budget change for this campaign didn't go through.",
      },
    }),
  },
];

export default fixture;
