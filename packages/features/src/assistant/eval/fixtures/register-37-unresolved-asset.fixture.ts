import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Register #37 — Claire invented an asset id (guessed `PRad.png`, three times)
 * for an ad creative the owner referenced only in words.
 *
 * No-silent-substitution contract (Phase 7): `createDraftAd` accepts the
 * owner's wording as `assetRef` instead of a guessed id. When it can't resolve
 * to a single asset it returns `asset_unresolved` with candidates, and the ad
 * is NOT created — Claire asks which one. She must not report a launch/creation
 * that never happened.
 */
const fixture: ClaireFixture = {
  id: 'register-37-unresolved-asset',
  description:
    'A word-only asset reference that resolves to several candidates makes Claire ask, not guess an id or create the ad (#37).',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['create-ad'] },
  turns: [
    {
      userMessage: 'Run my Endosphere photo as the ad.',
      expect: {
        toolsCalled: ['createDraftAd'],
        responseContains: ['which'],
        responseLacks: ['launched', 'is now live'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'checkMetaIntegration',
    respond: () => ({ ok: true, data: { connected: true } }),
  },
  {
    name: 'listCampaigns',
    respond: () => ({
      ok: true,
      data: {
        campaigns: [
          { id: 'camp-1', metaCampaignId: 'camp-1', name: 'Endosphere — July' },
        ],
        total: 1,
      },
    }),
  },
  {
    name: 'createDraftAd',
    respond: () => ({
      ok: true,
      data: {
        assetUnresolved: {
          assetRef: 'Endosphere photo',
          candidates: [
            {
              id: 'asset-1',
              name: 'Endosphere before',
              thumbnailUrl: null,
              blobUrl: null,
            },
            {
              id: 'asset-2',
              name: 'Endosphere after',
              thumbnailUrl: null,
              blobUrl: null,
            },
          ],
        },
        message:
          'I found more than one asset that could be "Endosphere photo": "Endosphere before", "Endosphere after". Which one should I use?',
      },
    }),
  },
];

export default fixture;
