import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Register finding #95 (loop / duplicates). A repeated "launch" produced a
 * SECOND live ad on the same budget. Phase 4 makes a re-launch of an
 * already-live ad a NO-OP: `executeLaunchAd` re-reads the ad's real state from
 * Meta (Phase 1) and returns `launchState: 'already_live'` with
 * `alreadyLive: true` — nothing new is created and no extra budget is spent.
 * Claire must say it's already running, never imply a fresh launch.
 *
 * Register data is customer data — org name and quote are stripped.
 */
const fixture: ClaireFixture = {
  id: 'register-95-double-launch-already-live',
  description:
    'Re-launching an already-live ad returns already_live (a no-op); Claire says it is already running and does not claim a new launch or a second ad.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['create-ad'] },
  turns: [
    {
      userMessage: 'Launch that Botox ad again.',
      expect: {
        toolsCalled: ['executeLaunchAd'],
        responseContains: ['already'],
        responseLacks: [
          'launched a new',
          'second ad',
          'going live',
          'now live and',
        ],
        claimsRequireToolSupport: [
          { phrase: 'already', support: 'already_live' },
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
        title: 'Ad already live: Botox winter promo',
        adId: 'ad-1',
        name: 'Botox winter promo',
        launchState: 'already_live',
        alreadyLive: true,
        launchStateDetail:
          'This ad was already launched — no new ad was created and no extra budget was spent. Verified with Meta: the ad is active and its campaign is delivering.',
        message:
          'This ad was already launched — no new ad was created and no extra budget was spent. Verified with Meta: the ad is active and its campaign is delivering.',
      },
    }),
  },
];

export default fixture;
