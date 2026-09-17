import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'tool-dispatch-ad-launch',
  description:
    'User asks Claire to launch an existing draft ad; Claire goes through the create-ad flow up to confirmLaunchAd.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['create-ad'] },
  turns: [
    {
      userMessage: 'Launch the lip-filler video ad I drafted.',
      expect: {
        toolsCalled: ['checkMetaIntegration', 'listRecentVideos'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'checkMetaIntegration',
    respond: () => ({
      ok: true,
      data: {
        connected: true,
        hasAdAccount: true,
        hasFacebookPage: true,
        configurationComplete: true,
      },
    }),
  },
  {
    name: 'listRecentVideos',
    respond: () => ({
      ok: true,
      data: {
        videos: [
          {
            id: 'v1',
            title: 'Lip filler — winter promo',
            status: 'ready',
            createdAt: '2026-04-20T09:00:00Z',
          },
          {
            id: 'v2',
            title: 'Anti-wrinkle quick result',
            status: 'ready',
            createdAt: '2026-04-18T09:00:00Z',
          },
        ],
      },
    }),
  },
];

export default fixture;
