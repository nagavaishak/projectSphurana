import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * W-C10-clip-tray fixture #2: operator dropped clips out of band; Claire
 * fills the rest.
 *
 * The operator drag-dropped two clips into the chat composer before sending
 * "fill the rest". Claire calls `listDraftClips` (gets back two `uploaded`
 * rows), then calls `autoSelectClips` with `excludeIds` set to the dropped
 * assetIds and `fillToCount: 1` to fill the remaining beat.
 */
const fixture: ClaireFixture = {
  id: 'tool-dispatch-tray-mixed-fill',
  description:
    'Generate-video skill (W-C10-clip-tray): tray has 2 uploaded clips; Claire calls listDraftClips then autoSelectClips with excludeIds + fillToCount: 1.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['generate-video'] },
  turns: [
    {
      userMessage:
        'I dropped two clips in already — fill the rest from the library for the lip filler video draft.',
      expect: {
        toolsCalled: ['listDraftClips', 'autoSelectClips'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'listDraftClips',
    respond: () => ({
      ok: true,
      data: {
        videoId: 'v-tray-mixed-1',
        clipCount: 2,
        emptyBeats: null,
        clips: [
          {
            id: 'tc-1',
            assetId: 'a-dropped-1',
            source: 'uploaded',
            processingStatus: 'ready',
            beatOrder: 0,
            name: 'closeup-procedure.mp4',
            duration: 12,
            tags: ['procedure'],
          },
          {
            id: 'tc-2',
            assetId: 'a-dropped-2',
            source: 'uploaded',
            processingStatus: 'ready',
            beatOrder: 1,
            name: 'environment.mp4',
            duration: 8,
            tags: ['environment'],
          },
        ],
      },
    }),
  },
  {
    name: 'autoSelectClips',
    respond: () => ({
      ok: true,
      data: {
        selectedClips: [
          {
            assetId: 'a-suggest-1',
            name: 'after-shot.mov',
            duration: 6,
            blobUrl: null,
          },
        ],
        totalAvailable: 12,
        videoId: 'v-tray-mixed-1',
        excluded: 2,
        trayUpdated: true,
      },
    }),
  },
];

export default fixture;
