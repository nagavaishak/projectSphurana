import { z } from 'zod';
import { ApiFetchError, defineTool } from '../../tool-factory/index.js';

interface DraftClipResponseRow {
  id: string;
  videoId: string;
  assetId: string | null;
  source: 'uploaded' | 'library' | 'suggested';
  beatOrder: number;
  processingStatus: 'uploading' | 'processing' | 'ready' | 'failed';
  asset: {
    id: string;
    name: string;
    type: string;
    duration: number | null;
    blobUrl: string | null;
    thumbnailUrl: string | null;
    tags: string[];
  } | null;
}

interface DraftClipsListResponse {
  clips?: DraftClipResponseRow[];
}

interface ListDraftClipsOutput {
  videoId: string;
  clipCount: number;
  emptyBeats: number | null;
  clips: Array<{
    id: string;
    assetId: string | null;
    source: 'uploaded' | 'library' | 'suggested';
    processingStatus: 'uploading' | 'processing' | 'ready' | 'failed';
    beatOrder: number;
    name: string | null;
    duration: number | null;
    tags: string[];
  }>;
  error?: string;
}

/**
 * `videos_listDraftClips` — read the chat-native tray for a video draft.
 *
 * The frontend mounts a persistent tray component scoped to the active
 * `videoId`; this tool gives Claire visibility into what's already there
 * before she calls `autoSelectClips` to fill the rest. The skill prompt
 * (W-C10-clip-tray Step 5) directs Claire to call this *before* deciding
 * whether to ask the operator about clip selection.
 *
 * Returns one row per tile in the tray, plus aggregate counts. `emptyBeats`
 * is null because the variation's `recommendedClipCount` lives template-side
 * — the model can compare `clipCount` against what `createDraftVideo` /
 * `autoSelectClips` returned for the template.
 */
export const listDraftClipsTool = defineTool<
  { videoId: string },
  ListDraftClipsOutput
>({
  feature: 'videos',
  action: 'listDraftClips',
  description:
    'Read the chat-native clip tray for a video draft. Returns the clips ' +
    'the operator has uploaded or picked, plus any suggestions Claire has ' +
    'already persisted via autoSelectClips. Call this before deciding ' +
    'whether the operator needs to choose more clips.',
  inputSchema: z.object({
    videoId: z.string().min(1).describe('The draft video ID'),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Reading clip tray' },
  // The tray endpoint isn't in the default whitelist — extend per-tool.
  additionalAllowedPaths: [/^videos\/[a-zA-Z0-9_-]+\/draft-clips$/],
  execute: async ({ videoId }, ctx) => {
    try {
      const data = await ctx.apiFetch<DraftClipsListResponse>(
        `videos/${videoId}/draft-clips`
      );
      const clips = (data?.clips ?? []).map((c) => ({
        id: c.id,
        assetId: c.assetId,
        source: c.source,
        processingStatus: c.processingStatus,
        beatOrder: c.beatOrder,
        name: c.asset?.name ?? null,
        duration: c.asset?.duration ?? null,
        tags: c.asset?.tags ?? [],
      }));
      return {
        data: {
          videoId,
          clipCount: clips.length,
          emptyBeats: null,
          clips,
        },
      };
    } catch (error) {
      const isExpectedClientError =
        error instanceof ApiFetchError &&
        error.status >= 400 &&
        error.status < 500;
      if (!isExpectedClientError) {
        ctx.reportIssue('Failed to load draft clips', { error });
      }
      return {
        data: {
          videoId,
          clipCount: 0,
          emptyBeats: null,
          clips: [],
          error:
            error instanceof Error ? error.message : 'Failed to read clip tray',
        },
      };
    }
  },
});
