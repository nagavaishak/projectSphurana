import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Register finding #138 (false-success). A freshly-launched ad sitting in
 * Meta's review queue was reported as live. Phase 1's read-back returns
 * `launchState: 'pending_review'`; Claire must say it is in review and NOT
 * live yet, never that it is running.
 *
 * Register data is customer data — org name and quote stripped.
 */
const fixture: ClaireFixture = {
  id: 'register-138-pending-review-not-live',
  description:
    'A launch that lands in Meta review returns pending_review; Claire reports it is in review and not live yet, never that it is running.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['create-ad'] },
  turns: [
    {
      userMessage: 'Great, launch it. Is it live now?',
      expect: {
        toolsCalled: ['executeLaunchAd'],
        responseContains: ['review', 'not live yet'],
        responseLacks: [
          'now live',
          'went live',
          'already live',
          'is live and delivering',
        ],
        claimsRequireToolSupport: [
          { phrase: 'review', support: 'pending_review' },
        ],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'executeLaunchAd',
    respond: () => ({
      ok: true,
      data: {
        uiState: 'created',
        title: 'Ad submitted: Anti-wrinkle spring offer',
        adId: 'ad-2',
        name: 'Anti-wrinkle spring offer',
        launchState: 'pending_review',
        launchStateDetail:
          'Verified with Meta: the ad is in Meta review. It is not live yet and will not deliver until Meta approves it.',
        message:
          'Verified with Meta: the ad is in Meta review. It is not live yet and will not deliver until Meta approves it.',
      },
    }),
  },
];

export default fixture;
