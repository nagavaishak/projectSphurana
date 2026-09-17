import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Register finding #79 (loop / duplicates). One "set up a campaign" request
 * produced two campaigns (and three lead forms). Phase 4 adds a pre-create
 * similarity check: `createCampaign` reads the recent action-intent log, finds
 * the near-duplicate the owner just made, and returns
 * `uiState: 'existing_candidates'` WITHOUT creating a second campaign. Claire
 * must surface the existing one and ask before creating a new one — never
 * silently spawn a duplicate on the same budget.
 *
 * Register data is customer data — org name and quote are stripped.
 */
const fixture: ClaireFixture = {
  id: 'register-79-duplicate-campaign-prevented',
  description:
    'A re-requested campaign that duplicates a recent one returns existing_candidates; Claire surfaces the existing campaign and asks before creating a second — no duplicate is created.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['create-ad'] },
  turns: [
    {
      userMessage: 'Set up a Botox campaign for September.',
      expect: {
        toolsCalled: ['createCampaign'],
        responseContains: ['already'],
        responseLacks: [
          'created a new campaign',
          "i've set up",
          'campaign is now live',
          'all set',
        ],
        claimsRequireToolSupport: [
          { phrase: 'already', support: 'existing_candidates' },
        ],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'createCampaign',
    respond: () => ({
      ok: true,
      data: {
        uiState: 'existing_candidates',
        title: 'You may already have this campaign',
        message:
          'You created 1 similar campaign recently. Do you want to reuse it, or create a brand-new campaign anyway? I will not create a duplicate unless you say so.',
        proposedName: 'Botox — September',
        existingCandidates: [
          {
            id: 'meta-camp-1',
            name: 'Botox — September',
            createdAt: '2026-07-29T10:00:00.000Z',
            matchReasons: ['same name', 'same objective'],
          },
        ],
      },
    }),
  },
];

export default fixture;
