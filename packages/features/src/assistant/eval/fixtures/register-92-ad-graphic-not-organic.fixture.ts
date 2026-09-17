import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Register #92 — an AD request answered with the ORGANIC graphic tool.
 *
 * In production "make me 2 ads for my Botox offer" was answered by the organic
 * `createGraphic` tool and the output relabelled "Ad 1" / "Ad 2". Root cause
 * (Phase 7): the ad-graphic tool `createAdGraphic` was absent from
 * `generate-graphic`'s `toolNames`, so it was invisible regardless of the
 * prompt. Now that it is exposed, an ad/offer request must dispatch
 * `createAdGraphic` and must NOT dispatch the organic `createGraphic`.
 *
 * `toolsNotCalled` is the load-bearing assertion — `toolsCalled` alone tolerates
 * the wrong tool also firing.
 */
const fixture: ClaireFixture = {
  id: 'register-92-ad-graphic-not-organic',
  description:
    'An ad/offer graphic request dispatches createAdGraphic, never the organic createGraphic (#92).',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['generate-graphic'] },
  turns: [
    {
      userMessage: 'Make me an ad graphic for my Botox offer.',
      expect: {
        toolsCalled: ['createAdGraphic'],
        toolsNotCalled: ['createGraphic'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'listServices',
    respond: () => ({
      ok: true,
      data: {
        services: [{ id: 'svc-botox', name: 'Botox' }],
        total: 1,
      },
    }),
  },
  {
    name: 'listOffers',
    respond: () => ({
      ok: true,
      data: {
        offers: [
          { id: 'offer-1', name: 'Botox intro', serviceId: 'svc-botox' },
        ],
        total: 1,
      },
    }),
  },
  {
    name: 'createAdGraphic',
    respond: () => ({
      ok: true,
      data: {
        graphicId: 'adg-1',
        status: 'rendering',
        serviceId: 'svc-botox',
        offerId: 'offer-1',
        uiState: 'created',
        title: 'Ad graphic',
      },
    }),
  },
];

export default fixture;
