import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

const VIDEO_STATUSES = [
  'draft',
  'queued',
  'processing',
  'ready',
  'failed',
] as const;
type VideoStatus = (typeof VIDEO_STATUSES)[number];

/**
 * LEFT ASSERTED ON PURPOSE.
 *
 * `listVideosResponseSchema` exists in `packages/contracts`, but it declares
 * each item as the FULL video row and `GET /videos` does not return one:
 * `listVideos` (`packages/features/src/videos/services/list-videos`) uses an
 * explicit `db.select({...})` that omits `errorMessage`, `usageType`,
 * `processingStage`, `stageStartedAt`, `schemaVersion`, `synthesisSeed`,
 * `variationId`, `serviceId`, `offerId` and `deletedAt` — all required by the
 * schema. Parsing here would throw `ApiResponseContractError` on 100% of calls.
 * The frontend hook parses the same endpoint with the same schema in report
 * mode, so the drift is logged, not fatal. Reported; fix the select (or the
 * projection), never loosen the contract.
 */
interface VideoListItem {
  id: string;
  title: string;
  status: string;
  templateId: string;
  blobUrl: string | null;
  thumbnailUrl: string | null;
  durationMs: number | null;
  createdAt: string;
}

interface ListRecentVideosInput {
  limit?: number;
  status?: VideoStatus;
}

interface ListRecentVideosOutput {
  videos: VideoListItem[];
  total: number;
}

/**
 * `context_listRecentVideos` — list recent draft / rendered videos.
 *
 * Ported from the legacy `listRecentVideos` tool in `context-tools.ts`.
 */
export const listRecentVideosTool = defineTool<
  ListRecentVideosInput,
  ListRecentVideosOutput
>({
  feature: 'context',
  action: 'listRecentVideos',
  description:
    'List recently created videos for the organization. Shows title, ' +
    'status, template, and creation date. Use status="ready" to find ' +
    'videos available for posting or scheduling.',
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe('Max videos to return (default: 10)'),
    status: z
      .enum(VIDEO_STATUSES)
      .optional()
      .describe('Filter by video status (e.g. "ready" for rendered videos)'),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Listing recent videos' },
  execute: async ({ limit, status }, ctx) => {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (status) params.set('status', status);
    const qs = params.toString();

    const data = await ctx.apiFetch<{
      items: VideoListItem[];
      total: number;
    }>(`videos${qs ? `?${qs}` : ''}`);

    let items = data.items;
    if (status) {
      items = items.filter((v) => v.status === status);
    }

    return {
      data: {
        videos: items.map((v) => ({
          id: v.id,
          title: v.title,
          status: v.status,
          templateId: v.templateId,
          blobUrl: v.blobUrl,
          thumbnailUrl: v.thumbnailUrl,
          durationMs: v.durationMs,
          createdAt: v.createdAt,
        })),
        total: items.length,
      },
    };
  },
});
