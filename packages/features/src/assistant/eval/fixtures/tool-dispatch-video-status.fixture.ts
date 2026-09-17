import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'tool-dispatch-video-status',
  description:
    'Generate-video skill (W-C10): user asks if their queued render is done; Claire calls getVideoStatus exactly once (no auto-polling) and reports the result.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['generate-video'] },
  turns: [
    {
      userMessage: 'Is my video ready yet?',
      expect: {
        toolsCalled: ['getVideoStatus'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'getVideoStatus',
    respond: () => ({
      ok: true,
      data: {
        videoId: 'v-new-1',
        status: 'ready',
        progress: 100,
        title: 'Lip filler — before and after',
        blobUrl: 'https://cdn.borradh.io/videos/v-new-1.mp4',
        thumbnailUrl: 'https://cdn.borradh.io/videos/v-new-1.jpg',
        durationMs: 22500,
      },
    }),
  },
];

export default fixture;
