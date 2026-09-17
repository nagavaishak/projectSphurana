import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Register finding #201 (false-success). When the launch call returns but the
 * status cannot be read back from Meta, the old code still wrote/reported
 * `ACTIVE`. Phase 1 returns `launchState: 'unverified'` in that case; Claire
 * must report the launch as submitted-but-unverified and must NOT claim it is
 * live until the state is confirmed.
 *
 * Register data is customer data — org name and quote stripped.
 */
const fixture: ClaireFixture = {
  id: 'register-201-unverified-launch-not-live',
  description:
    'When Meta read-back fails, executeLaunchAd returns unverified; Claire reports it as submitted but unverified, never as live.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['create-ad'] },
  turns: [
    {
      userMessage: 'Launch it and let me know it went live.',
      expect: {
        toolsCalled: ['executeLaunchAd'],
        responseContains: ['submitted'],
        responseLacks: [
          'now live',
          'went live',
          'confirmed live',
          'it is live',
          'running now',
        ],
        claimsRequireToolSupport: [
          { phrase: 'submitted', support: 'unverified' },
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
        title: 'Ad submitted: Skin-boost bundle',
        adId: 'ad-3',
        name: 'Skin-boost bundle',
        launchState: 'unverified',
        launchStateDetail:
          'The launch request was submitted, but the read-back from Meta failed — the ad must not be reported as live until verified.',
        message:
          'The launch request was submitted, but the read-back from Meta failed — the ad must not be reported as live until verified.',
      },
    }),
  },
];

export default fixture;
