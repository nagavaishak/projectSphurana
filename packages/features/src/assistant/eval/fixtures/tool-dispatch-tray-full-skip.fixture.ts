import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * W-C10-clip-tray fixture #3: tray is full when Claire reaches step 4.
 *
 * Operator dropped or pre-picked 3 clips; the template recommends 3.
 * `listDraftClips` returns the full count, and the rewritten skill prompt
 * directs Claire to skip clip selection entirely and move on (the next
 * defaults turn would be music).
 */
const fixture: ClaireFixture = {
  id: 'tool-dispatch-tray-full-skip',
  description:
    'Generate-video skill (W-C10-clip-tray): tray already full; Claire calls listDraftClips then skips selection — no autoSelectClips call.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['generate-video'] },
  turns: [
    {
      userMessage:
        "I've already loaded the clips for that lip filler video — finish it.",
      expect: {
        toolsCalled: ['listDraftClips'],
        responseLacks: ['autoSelectClips'],
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
        videoId: 'v-tray-full-1',
        clipCount: 3,
        emptyBeats: null,
        clips: [
          {
            id: 'tc-1',
            assetId: 'a-1',
            source: 'uploaded',
            processingStatus: 'ready',
            beatOrder: 0,
            name: 'before.mp4',
            duration: 5,
            tags: [],
          },
          {
            id: 'tc-2',
            assetId: 'a-2',
            source: 'library',
            processingStatus: 'ready',
            beatOrder: 1,
            name: 'middle.mp4',
            duration: 4,
            tags: [],
          },
          {
            id: 'tc-3',
            assetId: 'a-3',
            source: 'uploaded',
            processingStatus: 'ready',
            beatOrder: 2,
            name: 'after.mp4',
            duration: 6,
            tags: [],
          },
        ],
      },
    }),
  },
];

export default fixture;
