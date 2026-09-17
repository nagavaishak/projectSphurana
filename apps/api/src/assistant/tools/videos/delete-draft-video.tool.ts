import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const deleteDraftVideoInputSchema = z.object({
  videoId: z
    .string()
    .min(1)
    .regex(/^[\w-]+$/, 'Invalid ID format')
    .describe(
      'UUID of the video to delete. It must not currently be queued or rendering.'
    ),
  confirmationToken: z
    .string()
    .optional()
    .describe('Confirmation token from the first call. Pass back unchanged.'),
});

interface VideoLookup {
  id: string;
  title: string;
  status: string;
}

interface DeleteDraftVideoOutput {
  videoId: string;
  deleted: boolean;
}

/**
 * `videos_deleteDraftVideo` — soft-delete a video that is safe to remove.
 *
 * Draft, ready, and failed videos can be deleted. Queued/processing videos
 * stay protected because their worker can still write an output after the
 * soft-delete; the operator should wait for that render to settle first.
 *
 * Destructive (DB write). Uses the factory two-call confirmation flow so the
 * operator always confirms which draft will be removed before the delete runs.
 */
export const deleteDraftVideoTool = defineTool<
  z.infer<typeof deleteDraftVideoInputSchema>,
  DeleteDraftVideoOutput
>({
  feature: 'videos',
  action: 'deleteDraftVideo',
  description:
    'Permanently delete a draft, completed, or failed video. ' +
    'Videos that are queued or currently rendering cannot be deleted yet. ' +
    'Requires operator confirmation. ' +
    'Use `listAvailableAssets` or `getVideoStatus` to find the video ID first.',
  inputSchema: deleteDraftVideoInputSchema,
  destructive: true,
  destructiveAction: 'delete_video_draft',
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Deleting video' },
  additionalAllowedPaths: [/^videos\/[a-zA-Z0-9_-]+$/],
  summarizeForConfirmation: async (input, ctx) => {
    const video = await ctx.apiFetch<VideoLookup>(`videos/${input.videoId}`);

    if (
      video.status !== 'draft' &&
      video.status !== 'ready' &&
      video.status !== 'failed'
    ) {
      throw new Error(
        `Cannot delete video "${video.title}" while it is ${video.status}. Wait for the render to finish first.`
      );
    }

    return {
      title: `Delete video "${video.title}"`,
      fields: [
        { label: 'Title', value: video.title },
        { label: 'Status', value: video.status },
      ],
      resourceId: input.videoId,
      payload: { videoId: input.videoId },
    };
  },
  execute: async (input, ctx) => {
    await ctx.apiFetch(`videos/${input.videoId}`, { method: 'DELETE' });

    return {
      data: {
        videoId: input.videoId,
        deleted: true,
      },
    };
  },
});
