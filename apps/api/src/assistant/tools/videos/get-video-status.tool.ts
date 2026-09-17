import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

interface GetVideoStatusOutput {
  videoId?: string;
  status?: string;
  progress?: number | null;
  processingStage?: string | null;
  title?: string;
  blobUrl?: string | null;
  thumbnailUrl?: string | null;
  durationMs?: number | null;
  error?: string;
}

/**
 * `videos_getVideoStatus` — check rendering progress for a video.
 *
 * Ported verbatim from the legacy `getVideoStatus` tool. The frontend's
 * `ProcessingStatus` renderer (which is mounted by `tool-renderer.tsx` when
 * the tool name `getVideoStatus` returns a non-ready status) handles the
 * long poll on its own — Claire calls this tool ONCE when the user asks for
 * status, never auto-polls. The renderer keys off the bare action name via
 * the controller's W-C02-E alias map.
 */
export const getVideoStatusTool = defineTool<
  { videoId: string },
  GetVideoStatusOutput
>({
  feature: 'videos',
  action: 'getVideoStatus',
  description:
    'Check the rendering progress of a video. Returns status, ' +
    'progress percentage, and the video URL when ready.',
  inputSchema: z.object({
    videoId: z.string().min(1).describe('The video ID to check'),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Checking video status' },
  execute: async ({ videoId }, ctx) => {
    const result = await ctx.ports.videos.getStatus(videoId);

    if (result.status === 'not_found') {
      return {
        data: {
          videoId,
          error: "I can't find that video — it may have been deleted.",
        },
      };
    }

    // `ready` is the ONLY branch that carries a URL, and the port cannot
    // construct it without one. The shape this replaces allowed
    // `{ status: 'ready', blobUrl: null }`.
    if (result.status === 'ready') {
      return {
        presentation: {
          type: 'video_status' as const,
          videoId,
          status: 'ready',
          title: result.title,
          ...(result.thumbnailUrl ? { thumbnailUrl: result.thumbnailUrl } : {}),
          blobUrl: result.url,
          ...(result.durationMs !== null
            ? { durationMs: result.durationMs }
            : {}),
        },
        data: {
          videoId,
          status: 'ready',
          title: result.title,
          progress: 100,
          blobUrl: result.url,
          thumbnailUrl: result.thumbnailUrl,
          durationMs: result.durationMs,
        },
      };
    }

    if (result.status === 'failed') {
      return {
        data: {
          videoId,
          status: 'failed',
          title: result.title,
          error: result.reason ?? 'The render failed.',
        },
      };
    }

    if (result.status === 'draft') {
      return {
        data: { videoId, status: 'draft', title: result.title },
      };
    }

    return {
      // Still running. The card polls `GET /videos/:id` itself and swaps to the
      // video when it lands, so this is the last call anyone needs to make.
      presentation: {
        type: 'video_status' as const,
        videoId,
        status: result.status,
        title: result.title,
        ...(result.progress !== null ? { progress: result.progress } : {}),
        ...(result.stage ? { processingStage: result.stage } : {}),
      },
      data: {
        videoId,
        status: result.status,
        title: result.title,
        progress: result.progress,
        processingStage: result.stage,
      },
    };
  },
});
