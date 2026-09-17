import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Register finding #151 (loop / duplicates). A fifth duplicate campaign was
 * created within six hours. Phase 4's pre-create similarity check returns
 * `existing_candidates` listing the recent near-duplicates, so Claire stops and
 * asks instead of piling on another campaign. This pins the "several already
 * exist" shape (more than one candidate) distinctly from #79.
 *
 * Register data is customer data — org name and quote are stripped.
 */
const fixture: ClaireFixture = {
  id: 'register-151-sixth-campaign-existing-candidates',
  description:
    'When several near-duplicate campaigns already exist, createCampaign returns them all as existing_candidates; Claire surfaces them and does not create yet another duplicate.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['create-ad'] },
  turns: [
    {
      userMessage: 'Create another lip filler campaign.',
      expect: {
        toolsCalled: ['createCampaign'],
        responseContains: ['already'],
        responseLacks: [
          'created a new campaign',
          "i've set up",
          'all set',
          'campaign is now live',
        ],
        claimsRequireToolSupport: [
          { phrase: 'already', support: 'existing_candidates' },
        ],
      },
    },
  ],
};

const candidates = [
  {
    id: 'meta-camp-3',
    name: 'Lip filler — launch offer',
    createdAt: '2026-07-30T06:00:00.000Z',
    matchReasons: ['similar name', 'same objective', 'same service'],
  },
  {
    id: 'meta-camp-2',
    name: 'Lip filler special',
    createdAt: '2026-07-30T03:00:00.000Z',
    matchReasons: ['similar name', 'same service'],
  },
  {
    id: 'meta-camp-1',
    name: 'Lip filler promo',
    createdAt: '2026-07-30T01:00:00.000Z',
    matchReasons: ['similar name', 'same objective'],
  },
];

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'createCampaign',
    respond: () => ({
      ok: true,
      data: {
        uiState: 'existing_candidates',
        title: 'You may already have this campaign',
        message:
          'You created 3 similar campaigns recently. Do you want to reuse one of those, or create a brand-new campaign anyway? I will not create a duplicate unless you say so.',
        proposedName: 'Lip filler campaign',
        existingCandidates: candidates,
      },
    }),
  },
];

export default fixture;
