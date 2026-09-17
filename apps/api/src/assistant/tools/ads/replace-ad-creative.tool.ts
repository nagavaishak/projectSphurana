import { getAssetResponseSchema } from '@borradh-workspace/contracts';
import { z } from 'zod';
import { ApiFetchError, defineTool } from '../../tool-factory/index.js';
import {
  type AssetUnresolvedOutput,
  resolveAssetReference,
} from '../_shared/asset-ref.js';

interface ReplaceCreativeApiResponse {
  id: string;
  name: string;
  headline: string | null;
  primaryText: string | null;
  callToAction: string | null;
  destinationUrl: string | null;
  videoId: string | null;
  graphicId: string | null;
  status: string;
}

interface ReplaceCreativeOutput {
  uiState?: 'updated';
  adId?: string;
  status?: string;
  preview?: {
    variant: 'draft';
    adName: string;
    headline?: string;
    primaryText?: string;
    callToAction?: string;
    destinationUrl?: string;
    videoId?: string;
    graphicId?: string;
    assetImageUrl?: string;
    assetVideoUrl?: string;
    assetThumbnailUrl?: string;
  };
  /**
   * Honest dead-end union (Phase 7, item 5): a live/published ad's creative
   * can't be swapped in place. Rather than surface a raw 4xx, point Claire at
   * the supported path — duplicate the ad as a draft, swap the creative on the
   * copy, launch that. `requiresNewAd` is the discriminator the skill keys off.
   */
  requiresNewAd?: { adId: string };
  message?: string;
  error?: string;
}

export const replaceAdCreativeTool = defineTool<
  {
    adId: string;
    videoId?: string;
    graphicId?: string;
    assetId?: string;
    assetRef?: string;
  },
  ReplaceCreativeOutput | AssetUnresolvedOutput
>({
  feature: 'meta-ads',
  action: 'replaceAdCreative',
  description:
    'Replace the creative on one unpublished Borradh draft ad in place. The ' +
    'same ad row, campaign, copy, targeting, services, and sibling ads are ' +
    'preserved. Call listRecentAds first to resolve the ad ID, then pass ' +
    'exactly ONE of: videoId (AI/rendered video), graphicId (AI-generated ' +
    "graphic), or assetId (one of the operator's OWN uploaded library " +
    'images/videos, from listLibraryImages). Use this for a single creative ' +
    'swap; use the campaign rebuild flow only when the user asks to redo all ads.',
  inputSchema: z
    .object({
      adId: z.string().min(1).describe('The unpublished local draft ad ID'),
      videoId: z.string().min(1).optional(),
      graphicId: z.string().min(1).optional(),
      assetId: z
        .string()
        .min(1)
        .optional()
        .describe(
          "A library / uploaded media asset ID from the operator's own media " +
            'library (from listLibraryImages) — swaps in one of their own ' +
            'uploaded images/videos as the ad creative.'
        ),
      assetRef: z
        .string()
        .min(1)
        .optional()
        .describe(
          "The owner's own words for an uploaded asset when you do NOT have " +
            'its id (e.g. "my Endosphere photo"). Pass this INSTEAD of guessing ' +
            'an assetId — the tool resolves it or asks which one. Provide this ' +
            'OR one of videoId/graphicId/assetId, not both.'
        ),
    })
    .refine(
      (input) => {
        const resolved =
          Number(!!input.videoId) +
          Number(!!input.graphicId) +
          Number(!!input.assetId);
        if (resolved > 1) return false;
        return resolved === 1 || !!input.assetRef;
      },
      {
        message:
          'Provide exactly one creative: a videoId, a graphicId, an assetId, ' +
          'or an assetRef for the tool to resolve',
        path: ['assetId'],
      }
    ),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Replacing ad creative' },
  additionalAllowedPaths: [/^meta-ads\/[a-zA-Z0-9_-]+\/creative$/],
  execute: async ({ adId, videoId, graphicId, assetId, assetRef }, ctx) => {
    // No-silent-substitution (Phase 7): resolve an owner asset reference to a
    // real assetId, or return candidates so Claire asks — never guess.
    let resolvedAssetId = assetId;
    if (!videoId && !graphicId && !resolvedAssetId && assetRef) {
      const resolution = await resolveAssetReference(ctx, {
        assetRef,
        hasResolvedCreative: false,
        mode: 'attach',
      });
      if (resolution.outcome === 'unresolved') {
        return { data: resolution.data };
      }
      if (resolution.outcome === 'resolved') {
        resolvedAssetId = resolution.assetId;
      }
    }

    // A library / uploaded asset id rides the `videoId` slot — the replace
    // service checks the asset table there, and launch turns an image asset
    // into a Meta image creative (resolveMediaAsset → uploadImage).
    const effectiveVideoId = videoId ?? resolvedAssetId;

    // Resolve a library-asset creative's URL + type so the preview renders it
    // directly (the card polls /videos or /graphics by id, which 404s for an
    // asset id and would spin forever). Best-effort.
    let assetImageUrl: string | undefined;
    let assetVideoUrl: string | undefined;
    let assetThumbnailUrl: string | undefined;
    if (resolvedAssetId) {
      try {
        const assetRecord = await ctx.apiFetch(`assets/${resolvedAssetId}`, {
          schema: getAssetResponseSchema,
        });
        if (assetRecord.type === 'image') {
          assetImageUrl = assetRecord.blobUrl ?? undefined;
        } else {
          assetVideoUrl = assetRecord.blobUrl ?? undefined;
          assetThumbnailUrl = assetRecord.thumbnailUrl ?? undefined;
        }
      } catch {
        // Non-fatal — the swap still applies; the preview just shows copy only.
      }
    }

    try {
      const data = await ctx.apiFetch<ReplaceCreativeApiResponse>(
        `meta-ads/${adId}/creative`,
        {
          method: 'PUT',
          body: {
            ...(effectiveVideoId ? { videoId: effectiveVideoId } : {}),
            ...(graphicId ? { graphicId } : {}),
          },
        }
      );
      return {
        presentation: { type: 'ad_preview' as const },
        data: {
          uiState: 'updated',
          adId: data.id,
          status: data.status,
          preview: {
            variant: 'draft',
            adName: data.name,
            ...(data.headline ? { headline: data.headline } : {}),
            ...(data.primaryText ? { primaryText: data.primaryText } : {}),
            ...(data.callToAction ? { callToAction: data.callToAction } : {}),
            ...(data.destinationUrl
              ? { destinationUrl: data.destinationUrl }
              : {}),
            // For a library-asset creative, render directly from its URL and
            // skip the id poll (the stored videoId is an asset id the card
            // can't fetch as a /videos row).
            ...(resolvedAssetId
              ? {}
              : data.videoId
                ? { videoId: data.videoId }
                : {}),
            ...(data.graphicId ? { graphicId: data.graphicId } : {}),
            ...(assetImageUrl ? { assetImageUrl } : {}),
            ...(assetVideoUrl ? { assetVideoUrl } : {}),
            ...(assetThumbnailUrl ? { assetThumbnailUrl } : {}),
          },
        },
      };
    } catch (error) {
      const expected =
        error instanceof ApiFetchError &&
        error.status >= 400 &&
        error.status < 500;

      // Honest dead-end (item 5): the service only allows a creative swap on an
      // unpublished Borradh draft (`INVALID_AD_STATE` → "Creative can only be
      // replaced on an unpublished Borradh draft ad"). For a live/imported ad
      // this is not a generic failure — the supported path is duplicate → swap
      // → launch. Surface `requiresNewAd` so the skill offers that, instead of
      // dead-ending on a raw 4xx.
      const message = error instanceof Error ? error.message : '';
      const isLockedToLiveAd =
        expected && /can only be replaced on an unpublished/i.test(message);
      if (isLockedToLiveAd) {
        return {
          data: {
            requiresNewAd: { adId },
            message:
              "That ad is already live, so Meta won't let me swap its " +
              'creative in place. I can duplicate it as a draft, put the new ' +
              'creative on the copy, and launch that instead — want me to?',
          },
        };
      }

      if (!expected)
        ctx.reportIssue('Failed to replace ad creative', { error });
      return {
        data: {
          error:
            error instanceof Error
              ? error.message
              : 'Failed to replace ad creative.',
        },
      };
    }
  },
});
