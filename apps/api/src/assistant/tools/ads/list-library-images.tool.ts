import { assetLibraryListingSchema } from '@borradh-workspace/contracts';
import { z } from 'zod';
import { ApiFetchError, defineTool } from '../../tool-factory/index.js';

interface ListLibraryImagesOutput {
  images?: Array<{
    id: string;
    name: string;
    thumbnailUrl: string | null;
    blobUrl: string | null;
  }>;
  total?: number;
  error?: string;
}

/**
 * `meta_ads_listLibraryImages` — list the operator's own uploaded / library
 * IMAGE assets (the `asset` table, `type='image'`) so they can be used as ad
 * creative.
 *
 * The ad-building skills (create-ad / create-campaign) previously reached
 * creative only through AI-generated content — `createDraftVideo` → videoId,
 * `createAdGraphic` → graphicId. So Claire had no way to see or pick one of the
 * operator's OWN uploaded photos for an ad, even though the Meta-ads launch
 * path already accepts an image asset (resolveMediaAsset → uploadImage →
 * link_data.image_hash). This tool closes that discovery gap: it surfaces the
 * uploaded images with their asset IDs, which Claire then attaches to a draft
 * ad via the `assetId` field on `createDraftAd` / `replaceAdCreative`.
 *
 * Deliberately DISTINCT from `videos_listAvailableAssets`: that tool's frontend
 * renderer (ClipSelectionGrid) drives the draft-VIDEO clip-swap flow ("update
 * the draft video with these clips"), which is the wrong flow for ad creative.
 * This tool is image-only and carries no clip-selection UI.
 */
export const listLibraryImagesTool = defineTool<
  { serviceId?: string },
  ListLibraryImagesOutput
>({
  feature: 'meta-ads',
  action: 'listLibraryImages',
  description:
    "List the operator's own uploaded / library IMAGE assets (their photos) to " +
    'use as ad creative — for when the user says "use my own image" / "use one ' +
    'of my Endosphere photos" / "run this uploaded image as the ad". Optionally ' +
    'filter by service. Returns image asset IDs, names, and thumbnails. Attach a ' +
    'chosen image to a draft ad by passing its id as `assetId` on createDraftAd ' +
    'or replaceAdCreative.',
  inputSchema: z.object({
    serviceId: z
      .string()
      .min(1)
      .optional()
      .describe('Filter to images tagged for this service (recommended)'),
  }),
  destructive: false,
  // Read-only listing of the org's own media library — any authenticated
  // member of the org may see it. Declared explicitly because Gate 3 cannot
  // distinguish "open on purpose" from "nobody thought about it".
  policy: 'member',
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Listing library images' },
  execute: async ({ serviceId }, ctx) => {
    try {
      const path = serviceId
        ? `assets/by-service/${serviceId}?type=image`
        : 'assets?type=image&limit=50';
      const data = await ctx.apiFetch(path, {
        schema: assetLibraryListingSchema,
      });
      // Both library routes return `{ items }` — `assets.controller.ts:152`
      // and the paged list alike. This used to branch on `Array.isArray` to
      // match a union whose array arm was unreachable.
      const raw = data.items;
      // Defensive: the by-service endpoint may not honour the type filter, so
      // keep only images here too.
      const images = raw.filter((a) => a.type === 'image');
      return {
        data: {
          images: images.map((a) => ({
            id: a.id,
            name: a.name,
            thumbnailUrl: a.thumbnailUrl ?? null,
            blobUrl: a.blobUrl ?? null,
          })),
          total: images.length,
        },
      };
    } catch (error) {
      const isExpectedClientError =
        error instanceof ApiFetchError &&
        error.status >= 400 &&
        error.status < 500;
      if (!isExpectedClientError) {
        ctx.reportIssue('Failed to list library images', { error });
      }
      return {
        data: {
          error:
            error instanceof Error
              ? error.message
              : 'Failed to list library images',
        },
      };
    }
  },
});
