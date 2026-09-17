import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * W-C10-clip-tray fixture #1: tray is empty when Claire reaches step 4.
 *
 * Operator says "let me make a video"; Claire creates the draft, calls
 * `listDraftClips` (gets back zero rows), and the rewritten skill prompt
 * directs her to ask the 3-way clip question rather than fork on
 * auto-vs-manual.
 */
const fixture: ClaireFixture = {
  id: 'tool-dispatch-tray-empty-claire-asks',
  description:
    'Generate-video skill (W-C10-clip-tray): tray is empty after createDraftVideo; Claire calls listDraftClips and asks the 3-way clip question.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['generate-video'] },
  turns: [
    {
      userMessage: 'Let me make a video for the lip filler service.',
      expect: {
        toolsCalled: ['createDraftVideo', 'listDraftClips'],
        responseContains: ['clips'],
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
        videoId: 'v-tray-empty-1',
        templateId: 'before-after',
        variationId: 'before-after-1',
        status: 'draft',
        narrationMode: 'recorded',
        recommendedClipCount: 3,
      },
    }),
  },
  {
    name: 'listDraftClips',
    respond: () => ({
      ok: true,
      data: {
        videoId: 'v-tray-empty-1',
        clipCount: 0,
        emptyBeats: null,
        clips: [],
      },
    }),
  },
];

export default fixture;
