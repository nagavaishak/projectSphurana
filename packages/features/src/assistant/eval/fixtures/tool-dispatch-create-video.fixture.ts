import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'tool-dispatch-create-video',
  description:
    'Generate-video skill (W-C10): user asks for a before/after video; Claire walks through createDraftVideo → autoSelectClips against the porting target.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['generate-video'] },
  turns: [
    {
      userMessage:
        'Make me a before-and-after video for the lip filler service.',
      expect: {
        toolsCalled: ['createDraftVideo', 'autoSelectClips'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'createDraftVideo',
    respond: () => ({
      ok: true,
      data: {
        videoId: 'v-new-1',
        templateId: 'before-after',
        variationId: 'before-after-1',
        status: 'draft',
        narrationMode: 'recorded',
        recommendedClipCount: 3,
      },
    }),
  },
  {
    name: 'autoSelectClips',
    respond: () => ({
      ok: true,
      data: {
        selectedClips: [
          { assetId: 'a1', name: 'before.mov', duration: 4.2, blobUrl: null },
          { assetId: 'a2', name: 'middle.mov', duration: 3.8, blobUrl: null },
          { assetId: 'a3', name: 'after.mov', duration: 5.1, blobUrl: null },
        ],
        totalAvailable: 8,
        videoId: 'v-new-1',
      },
    }),
  },
];

export default fixture;
