import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Register #150 / #151 — the owner's own image was silently swapped for an
 * AI-generated one and reported as theirs.
 *
 * No-silent-substitution contract (Phase 7): when the owner references their
 * OWN upload, the generate tool (`createGraphic`) must NOT quietly produce an
 * AI image. It passes the wording as `assetRef`; the tool returns
 * `asset_unresolved` with candidates so Claire ASKS which one — it only
 * generates a new AI graphic on an explicit `generateNew`.
 *
 * `claimsRequireToolSupport` pins the "reported as theirs" half: Claire may not
 * say "your photo" unless a tool result actually carried the resolved asset
 * (`assetImageUrl`). The unresolved result carries none, so any such claim
 * fails the fixture.
 */
const fixture: ClaireFixture = {
  id: 'register-150-151-owner-asset-not-substituted',
  description:
    "An owner's referenced upload is never silently replaced by an AI graphic; Claire asks which asset (#150 #151).",
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['generate-graphic'] },
  turns: [
    {
      userMessage: 'Make me a graphic using my clinic photo.',
      expect: {
        toolsCalled: ['createGraphic'],
        responseContains: ['which'],
        claimsRequireToolSupport: [
          { phrase: 'your photo', support: 'assetImageUrl' },
        ],
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
        services: [{ id: 'svc-1', name: 'Skin treatments' }],
        total: 1,
      },
    }),
  },
  {
    name: 'createGraphic',
    respond: () => ({
      ok: true,
      data: {
        assetUnresolved: {
          assetRef: 'my clinic photo',
          candidates: [
            {
              id: 'asset-a',
              name: 'Clinic front',
              thumbnailUrl: null,
              blobUrl: null,
            },
            {
              id: 'asset-b',
              name: 'Clinic reception',
              thumbnailUrl: null,
              blobUrl: null,
            },
          ],
        },
        message:
          'I found more than one asset that could be "my clinic photo": "Clinic front", "Clinic reception". Which one should I use?',
      },
    }),
  },
];

export default fixture;
