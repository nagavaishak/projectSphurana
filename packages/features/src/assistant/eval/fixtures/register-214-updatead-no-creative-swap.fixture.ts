import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Register finding #214 (silent-wrong). `updateAd` edits copy only and rebuilds
 * the creative from the ad's EXISTING media refs — an image/video swap is
 * impossible here by construction — yet Claire narrated a picture swap. Phase 1
 * makes the result carry `creative: 'unchanged'` explicitly, so Claire must
 * report the headline change AND that the image was not touched (pointing at
 * replaceAdCreative for an actual swap).
 *
 * Register data is customer data — org name and quote stripped.
 */
const fixture: ClaireFixture = {
  id: 'register-214-updatead-no-creative-swap',
  description:
    'updateAd changes copy only and returns creative: unchanged; Claire reports the headline change and that the image is unchanged, never a swap.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['create-ad'] },
  turns: [
    {
      userMessage:
        "On draft ad ad-1, change the headline to 'Winter glow refresh' and swap the image to the new one.",
      expect: {
        toolsCalled: ['updateAd'],
        responseContains: ['headline'],
        responseLacks: [
          'swapped the image',
          'changed the image',
          'new image',
          'updated the image',
          'replaced the image',
        ],
        claimsRequireToolSupport: [
          { phrase: 'image is unchanged', support: '"creative":"unchanged"' },
        ],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'updateAd',
    respond: () => ({
      ok: true,
      data: {
        uiState: 'updated',
        title: 'Updated draft ad: Lip filler draft',
        adId: 'ad-1',
        name: 'Lip filler draft',
        status: 'draft',
        updated: ['headline'],
        creative: 'unchanged',
        preview: {
          variant: 'draft',
          adName: 'Lip filler draft',
          headline: 'Winter glow refresh',
        },
      },
    }),
  },
];

export default fixture;
