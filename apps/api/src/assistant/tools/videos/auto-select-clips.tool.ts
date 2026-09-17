import { getTemplateById } from '@borradh-workspace/features/videos/templates';
import { z } from 'zod';
import { ApiFetchError, defineTool } from '../../tool-factory/index.js';

const safeExternalId = z.string().regex(/^[\w-]+$/, 'Invalid ID format');

interface AssetItem {
  id: string;
  name: string;
  type: string;
  duration: number | null;
  blobUrl: string | null;
}

interface AutoSelectClipsOutput {
  selectedClips?: Array<{
    assetId: string;
    name: string;
    duration: number | null;
    blobUrl: string | null;
  }>;
  totalAvailable?: number;
  videoId?: string;
  excluded?: number;
  trayUpdated?: boolean;
  error?: string;
}

/**
 * `videos_autoSelectClips` — fill empty beats in a video draft from the
 * service's asset bag.
 *
 * Post W-C10-clip-tray:
 *   - Accepts optional `excludeIds` so the model can avoid re-suggesting
 *     clips the operator already has in the tray (uploaded or library-picked).
 *   - Accepts optional `fillToCount` so the model can request "fill 1 more
 *     beat" rather than always overwriting with the template default.
 *   - Persists each pick into `video_draft_clip` with `source: 'suggested'`
 *     via `POST /videos/:id/draft-clips` (best-effort — a tray-write failure
 *     doesn't unwind the underlying `bRollClips` PUT, since the render still
 *     reads from `bRollClips`; the tray is the operator-facing surface).
 */
export const autoSelectClipsTool = defineTool<
  {
    videoId: string;
    serviceId: string;
    templateId: string;
    count?: number;
    excludeIds?: string[];
    fillToCount?: number;
  },
  AutoSelectClipsOutput
>({
  feature: 'videos',
  action: 'autoSelectClips',
  description:
    'Fill empty beats in a video draft by picking video assets from the ' +
    "service's library. Use `excludeIds` to avoid re-suggesting clips the " +
    'operator already has in the tray (call `listDraftClips` first to read ' +
    'tray state). Use `fillToCount` to request a specific number of clips ' +
    'rather than the template default. Persists picks into the chat tray ' +
    'as suggestions; the operator can swap before final render.',
  inputSchema: z.object({
    videoId: z.string().min(1).describe('The draft video ID'),
    serviceId: z
      .string()
      .min(1)
      .describe('Service ID to filter assets by (cuid2 — pass verbatim)'),
    templateId: safeExternalId.describe('Template type for clip matching'),
    count: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe(
        'Total clips to select (defaults to template recommendation). ' +
          'Prefer `fillToCount` when the tray already has clips.'
      ),
    excludeIds: z
      .array(z.string().min(1))
      .optional()
      .default([])
      .describe(
        'Asset IDs already in the tray — these are skipped during selection.'
      ),
    fillToCount: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe(
        'Number of NEW clips to add (default: template recommendation minus ' +
          'excludeIds.length). Use this when the operator wants to "fill the ' +
          'rest" rather than start over.'
      ),
  }),
  // Persists rows into video_draft_clip via POST /videos/:id/draft-clips.
  additionalAllowedPaths: [/^videos\/[a-zA-Z0-9_-]+\/draft-clips$/],
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Selecting clips' },
  execute: async (
    { videoId, serviceId, templateId, count, excludeIds, fillToCount },
    ctx
  ) => {
    try {
      const template = getTemplateById(templateId);
      const recommended = template?.variations[0]?.recommendedClipCount ?? 3;

      const excluded = new Set(excludeIds ?? []);

      const data = await ctx.apiFetch<AssetItem[] | { items: AssetItem[] }>(
        `assets/by-service/${serviceId}`
      );

      const assets = Array.isArray(data) ? data : (data.items ?? []);
      const videoAssets = assets.filter((a) => a.type === 'video');
      const eligible = videoAssets.filter((a) => !excluded.has(a.id));

      // `fillToCount` is the new shape: how many to add. `count` is the legacy
      // shape: total beats. Prefer `fillToCount` when supplied; fall back to
      // `count`; fall back to the template default minus the excluded set so
      // a tray with 2 already-dropped clips fills the remaining beats.
      const targetCount =
        fillToCount ?? count ?? Math.max(0, recommended - excluded.size);

      const selected = eligible.slice(0, targetCount);

      if (selected.length === 0) {
        return {
          data: {
            error:
              videoAssets.length === 0
                ? 'No video assets found for this service. Please upload some clips first.'
                : 'No more clips available — everything matching is already in the tray.',
            selectedClips: [],
            totalAvailable: videoAssets.length,
            excluded: excluded.size,
          },
        };
      }

      const bRollClips = selected.map((a, i) => ({
        assetId: a.id,
        order: i + excluded.size,
        clipType: 'bRoll' as const,
      }));

      await ctx.apiFetch(`videos/${videoId}`, {
        method: 'PUT',
        body: { draftConfig: { bRollClips } },
      });

      // Persist into the chat tray as `suggested` rows. Best-effort — if the
      // tray write fails, the bRollClips PUT above still landed (the render
      // pipeline reads from there), so the user-visible flow keeps working.
      let trayUpdated = false;
      try {
        await ctx.apiFetch(`videos/${videoId}/draft-clips`, {
          method: 'POST',
          body: {
            clips: selected.map((a, i) => ({
              assetId: a.id,
              source: 'suggested' as const,
              beatOrder: i + excluded.size,
              processingStatus: 'ready' as const,
            })),
          },
        });
        trayUpdated = true;
      } catch {
        // Swallow — tray hydration on next operator send will pick the new
        // bRollClips up regardless. Surfaced to the model via trayUpdated:false
        // so it can mention the gap if anything looks off.
      }

      return {
        data: {
          selectedClips: selected.map((a) => ({
            assetId: a.id,
            name: a.name,
            duration: a.duration,
            blobUrl: a.blobUrl,
          })),
          totalAvailable: videoAssets.length,
          videoId,
          excluded: excluded.size,
          trayUpdated,
        },
      };
    } catch (error) {
      const isExpectedClientError =
        error instanceof ApiFetchError &&
        error.status >= 400 &&
        error.status < 500;
      if (!isExpectedClientError) {
        ctx.reportIssue('Failed to auto-select clips', { error });
      }
      return {
        data: {
          error:
            error instanceof Error
              ? error.message
              : 'Failed to auto-select clips',
        },
      };
    }
  },
});
