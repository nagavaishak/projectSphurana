import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'confirmation-queue-video-export',
  description:
    'Generate-video flow ends with queueVideoExport emitting a confirmation_required presentation bound to the new queue_video_export action (W-C10).',
  category: 'confirmation',
  setup: { initialLoadedSkillIds: ['generate-video'] },
  turns: [
    {
      userMessage: 'Render the lip-filler before/after video I just drafted.',
      expect: {
        confirmationPresented: 'queue_video_export',
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'queueVideoExport',
    destructive: true,
    destructiveAction: 'queue_video_export',
    summarizeForConfirmation: (input) => ({
      title: 'Render video',
      fields: [
        { label: 'Template', value: 'Before / After' },
        { label: 'Clips', value: '3 clips selected' },
        { label: 'Music', value: 'Disco Divas (123 BPM)' },
      ],
      resourceId: String(input.videoId ?? 'v-new-1'),
    }),
    respond: () => ({
      ok: true,
      data: {
        videoId: 'v-new-1',
        status: 'queued',
        message: 'Video queued for rendering. This usually takes 2-3 minutes.',
      },
    }),
  },
];

export default fixture;
