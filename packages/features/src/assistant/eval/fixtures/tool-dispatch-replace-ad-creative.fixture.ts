import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'tool-dispatch-replace-ad-creative',
  description:
    'Create-campaign editing path finds one draft ad and replaces only its creative in place.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['create-campaign'] },
  turns: [
    {
      userMessage:
        'Replace the creative on draft ad ad-1 with graphic g-new. Keep the copy and the other ads.',
      expect: {
        toolsCalled: ['listRecentAds', 'replaceAdCreative'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'listRecentAds',
    respond: () => ({
      ok: true,
      data: {
        ads: [
          {
            id: 'ad-1',
            name: 'Lip filler draft',
            status: 'draft',
            headline: 'Natural-looking results',
            primaryText: 'A subtle refresh, tailored to you.',
            callToAction: 'BOOK_NOW',
            videoId: 'video-old',
            graphicId: null,
            isImported: false,
          },
        ],
        total: 1,
      },
    }),
  },
  {
    name: 'replaceAdCreative',
    respond: () => ({
      ok: true,
      data: {
        uiState: 'updated',
        adId: 'ad-1',
        status: 'draft',
        preview: {
          variant: 'draft',
          adName: 'Lip filler draft',
          headline: 'Natural-looking results',
          primaryText: 'A subtle refresh, tailored to you.',
          callToAction: 'BOOK_NOW',
          graphicId: 'g-new',
        },
      },
    }),
  },
];

export default fixture;
