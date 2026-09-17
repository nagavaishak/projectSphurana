import { listMetaCampaignsResponseSchema } from '@borradh-workspace/contracts';
import { z } from 'zod';
import { ApiFetchError, defineTool } from '../../tool-factory/index.js';

const safeExternalId = z.string().regex(/^[\w-]+$/, 'Invalid ID format');

/**
 * `GET /meta-ads/campaigns/:id` is still ASSERTED, not parsed. The declared
 * `listAdsResponseSchema` projection requires the full `meta_ad` row
 * (`socialPostId`, `useExistingPost`, `followUpType`, `adPlacement`,
 * `metaPermalink`, …) plus a `video.id`, none of which `listAds`
 * (`packages/features/src/meta-ads/services/list-ads/`) selects — parsing
 * against it would throw `ApiResponseContractError` on every call. The
 * projection needs correcting before this call can be parsed.
 */
interface ListAdsApiResponse {
  ads: Array<{
    id: string;
    name: string;
    status: string;
    headline: string | null;
    primaryText: string | null;
    description: string | null;
    callToAction: string | null;
    destinationUrl: string | null;
    videoId: string | null;
    graphicId: string | null;
    graphicImageUrl: string | null;
    metaAdId: string | null;
    metaCampaignId: string;
    isImported: boolean;
    lastSyncAt: string | null;
    createdAt: string;
    video: {
      title: string | null;
      thumbnailUrl?: string | null;
      videoUrl?: string | null;
    } | null;
    services: Array<{ id: string; name: string }>;
  }>;
  total: number;
}

interface AdEntry {
  id: string;
  name: string;
  status: string;
  headline: string | null;
  primaryText: string | null;
  description: string | null;
  callToAction: string | null;
  destinationUrl: string | null;
  videoId: string | null;
  graphicId: string | null;
  videoTitle: string | null;
  preview: {
    creativeType: 'video' | 'graphic' | 'external' | null;
    creativeId: string | null;
    thumbnailUrl: string | null;
    mediaUrl: string | null;
  };
  metaAdId: string | null;
  metaCampaignId: string;
  isImported: boolean;
  lastSyncAt: string | null;
  services: Array<{ id: string; name: string }>;
  createdAt: string;
}

interface ListRecentAdsOutput {
  ads: AdEntry[];
  total: number;
  error?: string;
}

/**
 * `meta_ads_listRecentAds` — list recent ads for one campaign or across the
 * org's first 5 campaigns.
 *
 * Ported from the legacy `listRecentAds` tool (`ad-tools.ts`). Read-only.
 * The "first 5 campaigns" cap is preserved verbatim — the legacy heuristic
 * keeps the call cheap when the model just wants a snapshot.
 */
export const listRecentAdsTool = defineTool<
  {
    campaignId?: string;
    status?:
      | 'draft'
      | 'launching'
      | 'pending'
      | 'active'
      | 'paused'
      | 'rejected'
      | 'error';
    limit?: number;
  },
  ListRecentAdsOutput
>({
  feature: 'meta-ads',
  action: 'listRecentAds',
  description:
    'List recent Meta ads for the organization. Returns ad name, status, ' +
    'creative IDs, copy, CTA, preview media, and last sync date. Useful for seeing what ads ' +
    'are running or have been created recently.',
  inputSchema: z.object({
    campaignId: safeExternalId
      .optional()
      .describe(
        'Filter by Meta campaign ID. If omitted, shows ads from all campaigns.'
      ),
    status: z
      .enum([
        'draft',
        'launching',
        'pending',
        'active',
        'paused',
        'rejected',
        'error',
      ])
      .optional()
      .describe('Filter by ad status'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe('Max ads to return (default: 20)'),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Listing recent ads' },
  execute: async ({ campaignId, status, limit }, ctx) => {
    const maxAds = limit ?? 20;
    const buildQs = () => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      params.set('limit', String(maxAds));
      const qs = params.toString();
      return qs ? `?${qs}` : '';
    };
    const mapAd = (ad: ListAdsApiResponse['ads'][number]): AdEntry => ({
      id: ad.id,
      name: ad.name,
      status: ad.status,
      headline: ad.headline,
      primaryText: ad.primaryText,
      description: ad.description,
      callToAction: ad.callToAction,
      destinationUrl: ad.destinationUrl,
      videoId: ad.videoId,
      graphicId: ad.graphicId,
      videoTitle: ad.video?.title ?? null,
      preview: {
        creativeType: ad.graphicId
          ? 'graphic'
          : ad.videoId
            ? 'video'
            : ad.metaAdId
              ? 'external'
              : null,
        creativeId: ad.graphicId ?? ad.videoId ?? null,
        thumbnailUrl: ad.graphicImageUrl ?? ad.video?.thumbnailUrl ?? null,
        mediaUrl: ad.graphicImageUrl ?? ad.video?.videoUrl ?? null,
      },
      metaAdId: ad.metaAdId,
      metaCampaignId: ad.metaCampaignId,
      isImported: ad.isImported,
      lastSyncAt: ad.lastSyncAt,
      services: ad.services,
      createdAt: ad.createdAt,
    });

    try {
      if (campaignId) {
        const data = await ctx.apiFetch<ListAdsApiResponse>(
          `meta-ads/campaigns/${campaignId}${buildQs()}`
        );
        return {
          data: {
            ads: data.ads.map(mapAd),
            total: data.total,
          },
        };
      }

      const campaignData = await ctx.apiFetch('meta-campaigns', {
        schema: listMetaCampaignsResponseSchema,
      });
      const campaignsToQuery = campaignData.campaigns.slice(0, 5);
      const allAds: ListAdsApiResponse['ads'] = [];

      for (const campaign of campaignsToQuery) {
        try {
          const data = await ctx.apiFetch<ListAdsApiResponse>(
            `meta-ads/campaigns/${campaign.id}${buildQs()}`
          );
          allAds.push(...data.ads);
        } catch {
          // Skip campaigns that fail; legacy parity.
        }
      }

      const sorted = allAds
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
        .slice(0, maxAds);

      return {
        data: {
          ads: sorted.map(mapAd),
          total: sorted.length,
        },
      };
    } catch (error) {
      const isExpectedClientError =
        error instanceof ApiFetchError &&
        error.status >= 400 &&
        error.status < 500;
      if (!isExpectedClientError) {
        ctx.reportIssue('Failed to list recent ads', { error });
      }
      return {
        data: {
          ads: [],
          total: 0,
          error: error instanceof Error ? error.message : 'Failed to list ads.',
        },
      };
    }
  },
});
