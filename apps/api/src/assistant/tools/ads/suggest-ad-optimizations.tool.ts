import {
  type ListMetaCampaignsResponse,
  listMetaCampaignsResponseSchema,
  metaCampaignInsightsSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { ApiFetchError, defineTool } from '../../tool-factory/index.js';
import { resolveAdAccountCurrency } from '../_shared/ad-currency.js';

/**
 * `GET /meta-ads/campaigns/:id` is still ASSERTED, not parsed: the declared
 * `listAdsResponseSchema` projection requires the full `meta_ad` row
 * (`socialPostId`, `followUpType`, `adPlacement`, `metaPermalink`, …) plus a
 * `video.id`, and `listAds` selects none of those — parsing against it would
 * throw on every call. Only the two fields this tool actually reads are
 * declared here.
 */
interface ListAdsApiResponse {
  ads: Array<{
    metaAdId: string | null;
    services: Array<{ id: string; name: string }>;
  }>;
}

interface AdPerformanceEntry {
  metaAdId: string;
  adName: string;
  campaignId: string;
  campaignName: string;
  spend: number;
  reach: number;
  clicks: number;
  impressions: number;
  ctr: number;
  cpc: number;
  leads: number;
  cpl: number | null;
  services: string[];
}

type RecommendationType =
  | 'pause'
  | 'increase_budget'
  | 'create_new'
  | 'adjust_targeting';

interface Recommendation {
  type: RecommendationType;
  adName: string;
  metaAdId: string;
  campaignName: string;
  reason: string;
  metrics: Record<string, unknown>;
}

interface SuggestAdOptimizationsOutput {
  summary?:
    | {
        totalAdsAnalyzed: number;
        activeCampaigns: number;
        totalSpend: number;
        totalLeads: number;
        overallCpl: number | null;
        dateRange: { since: string; until: string };
      }
    | string;
  adPerformance: Array<{
    adName: string;
    metaAdId: string;
    campaignName: string;
    spend: number;
    reach: number;
    clicks: number;
    leads: number;
    ctr: number;
    cpl: number | null;
    services: string[];
  }>;
  recommendations: Recommendation[];
  error?: string;
}

const MIN_SPEND_THRESHOLD = 500; // cents

/**
 * `meta_ads_suggestAdOptimizations` — Claire's "review my ads" workflow.
 *
 * Ported from the legacy `suggestAdOptimizations` tool (`ad-tools.ts`).
 * Read-only. The recommendation heuristics are preserved verbatim — Claire
 * is meant to *propose* (pause / scale / create-new / adjust-targeting),
 * the actual destructive action goes through `confirmPauseAd` / etc.
 */
export const suggestAdOptimizationsTool = defineTool<
  { dateRange?: { since: string; until: string } },
  SuggestAdOptimizationsOutput
>({
  feature: 'meta-ads',
  action: 'suggestAdOptimizations',
  description:
    'Analyze all active ads, identify underperformers and top performers, ' +
    'and return specific actionable recommendations. Each recommendation has ' +
    'a type (pause, increase_budget, create_new, adjust_targeting) and a reason. ' +
    'Call this when the user asks to "optimize my ads" or review ad performance. ' +
    'IMPORTANT: Call checkMetaIntegration first to ensure Meta Ads is connected.',
  inputSchema: z.object({
    dateRange: z
      .object({
        since: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
          .describe('Start date in YYYY-MM-DD format'),
        until: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD')
          .describe('End date in YYYY-MM-DD format'),
      })
      .optional()
      .describe('Date range for analysis (defaults to last 7 days)'),
  }),
  destructive: false,
  preferredModel: 'opus',
  presentation: { statusLabel: 'Reviewing ad performance' },
  execute: async ({ dateRange }, ctx) => {
    const range =
      dateRange ??
      (() => {
        const until = new Date();
        const since = new Date();
        since.setDate(since.getDate() - 7);
        return {
          since: since.toISOString().split('T')[0] ?? '',
          until: until.toISOString().split('T')[0] ?? '',
        };
      })();

    try {
      let campaignData: ListMetaCampaignsResponse;
      try {
        campaignData = await ctx.apiFetch('meta-campaigns', {
          schema: listMetaCampaignsResponseSchema,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        if (
          msg.includes('not connected') ||
          msg.includes('not configured') ||
          msg.includes('Unauthorized')
        ) {
          return {
            data: {
              summary:
                'Meta Ads is not connected or configured. The user needs to connect Meta Ads in Settings → Integrations before we can analyse ad performance.',
              recommendations: [],
              adPerformance: [],
            },
          };
        }
        throw error;
      }

      const activeCampaigns = campaignData.campaigns.filter(
        (c) => c.status === 'ACTIVE'
      );

      if (activeCampaigns.length === 0) {
        return {
          data: {
            summary:
              campaignData.campaigns.length === 0
                ? 'No campaigns found. The user needs to create a campaign first in the Ads dashboard.'
                : 'No active campaigns found. All campaigns are paused or archived.',
            recommendations: [],
            adPerformance: [],
          },
        };
      }

      const allAdPerformance: AdPerformanceEntry[] = [];

      for (const campaign of activeCampaigns) {
        try {
          const params = new URLSearchParams();
          params.set('since', range.since);
          params.set('until', range.until);

          const insightsData = await ctx.apiFetch(
            `meta-campaigns/${campaign.id}/insights?${params.toString()}`,
            { schema: metaCampaignInsightsSchema }
          );

          const { totals, ads: insightAds } = insightsData;
          const totalSpend = totals.spend;
          const totalLeads = totals.leads;

          const servicesByMetaAdId = new Map<string, string[]>();
          try {
            const adsData = await ctx.apiFetch<ListAdsApiResponse>(
              `meta-ads/campaigns/${campaign.id}?limit=100`
            );
            for (const ad of adsData.ads) {
              if (ad.metaAdId) {
                servicesByMetaAdId.set(
                  ad.metaAdId,
                  ad.services.map((s) => s.name)
                );
              }
            }
          } catch {
            // Non-fatal — proceed without service annotations.
          }

          for (const ad of insightAds) {
            const spendRatio = totalSpend > 0 ? ad.spend / totalSpend : 0;
            const estimatedLeads = Math.round(totalLeads * spendRatio);
            const cpl =
              estimatedLeads > 0 ? Math.round(ad.spend / estimatedLeads) : null;

            allAdPerformance.push({
              metaAdId: ad.adId,
              adName: ad.adName,
              campaignId: campaign.id,
              campaignName: campaign.name,
              spend: ad.spend,
              reach: ad.reach,
              clicks: ad.clicks,
              impressions: ad.impressions,
              ctr: ad.ctr,
              cpc: ad.cpc,
              leads: estimatedLeads,
              cpl,
              services: servicesByMetaAdId.get(ad.adId) ?? [],
            });
          }
        } catch {
          // Skip campaigns that fail; legacy parity.
        }
      }

      if (allAdPerformance.length === 0) {
        return {
          data: {
            summary:
              'Active campaigns found but no ad delivery data in this period.',
            recommendations: [],
            adPerformance: [],
          },
        };
      }

      // Symbol for spend/CPL copy comes from the connected ad account's
      // currency (EUR fallback), never a hardcoded euro sign.
      const { symbol: currencySymbol } = (await resolveAdAccountCurrency(ctx))
        .currency;

      const recommendations: Recommendation[] = [];
      const sortedBySpend = [...allAdPerformance].sort(
        (a, b) => b.spend - a.spend
      );

      const adsWithLeads = allAdPerformance.filter(
        (a) => a.cpl !== null && a.cpl > 0
      );
      const avgCpl =
        adsWithLeads.length > 0
          ? Math.round(
              adsWithLeads.reduce((sum, a) => sum + (a.cpl ?? 0), 0) /
                adsWithLeads.length
            )
          : null;

      for (const ad of sortedBySpend) {
        if (ad.spend < MIN_SPEND_THRESHOLD) continue;
        const spendAmount = (ad.spend / 100).toFixed(2);

        if (ad.leads === 0 && ad.spend >= MIN_SPEND_THRESHOLD * 2) {
          recommendations.push({
            type: 'pause',
            adName: ad.adName,
            metaAdId: ad.metaAdId,
            campaignName: ad.campaignName,
            reason: `${currencySymbol}${spendAmount} spent with 0 leads. Consider pausing to stop wasting budget.`,
            metrics: {
              spend: ad.spend,
              reach: ad.reach,
              clicks: ad.clicks,
              leads: 0,
            },
          });

          if (ad.services.length > 0) {
            const serviceNames = ad.services.join(', ');
            recommendations.push({
              type: 'create_new',
              adName: ad.adName,
              metaAdId: ad.metaAdId,
              campaignName: ad.campaignName,
              reason: `Current ad for ${serviceNames} is underperforming. Try a different creative format (e.g., before-after or testimonial video).`,
              metrics: { services: ad.services },
            });
          }
        }

        if (ad.ctr < 0.5 && ad.reach > 500 && ad.leads === 0) {
          const alreadyFlagged = recommendations.find(
            (r) => r.metaAdId === ad.metaAdId && r.type === 'pause'
          );
          if (!alreadyFlagged) {
            recommendations.push({
              type: 'adjust_targeting',
              adName: ad.adName,
              metaAdId: ad.metaAdId,
              campaignName: ad.campaignName,
              reason: `Low CTR (${ad.ctr.toFixed(2)}%) despite ${ad.reach.toLocaleString()} reach. The creative may not be resonating with the audience.`,
              metrics: {
                ctr: ad.ctr,
                reach: ad.reach,
                clicks: ad.clicks,
              },
            });
          }
        }

        if (
          ad.cpl !== null &&
          avgCpl !== null &&
          ad.cpl < avgCpl * 0.7 &&
          ad.leads >= 2
        ) {
          const cplAmount = (ad.cpl / 100).toFixed(2);
          const avgCplAmount = (avgCpl / 100).toFixed(2);
          recommendations.push({
            type: 'increase_budget',
            adName: ad.adName,
            metaAdId: ad.metaAdId,
            campaignName: ad.campaignName,
            reason: `${currencySymbol}${cplAmount} per lead is well below average (${currencySymbol}${avgCplAmount}). Consider increasing budget to scale this ad.`,
            metrics: {
              cpl: ad.cpl,
              avgCpl,
              leads: ad.leads,
              spend: ad.spend,
            },
          });
        }
      }

      const totalSpend = allAdPerformance.reduce((s, a) => s + a.spend, 0);
      const totalLeads = allAdPerformance.reduce((s, a) => s + a.leads, 0);
      const overallCpl =
        totalLeads > 0 ? Math.round(totalSpend / totalLeads) : null;

      return {
        data: {
          summary: {
            totalAdsAnalyzed: allAdPerformance.length,
            activeCampaigns: activeCampaigns.length,
            totalSpend,
            totalLeads,
            overallCpl,
            dateRange: range,
          },
          adPerformance: allAdPerformance.map((a) => ({
            adName: a.adName,
            metaAdId: a.metaAdId,
            campaignName: a.campaignName,
            spend: a.spend,
            reach: a.reach,
            clicks: a.clicks,
            leads: a.leads,
            ctr: a.ctr,
            cpl: a.cpl,
            services: a.services,
          })),
          recommendations,
        },
      };
    } catch (error) {
      const isExpectedClientError =
        error instanceof ApiFetchError &&
        error.status >= 400 &&
        error.status < 500;
      if (!isExpectedClientError) {
        ctx.reportIssue('Failed to analyze ad performance', { error });
      }
      return {
        data: {
          adPerformance: [],
          recommendations: [],
          error:
            error instanceof Error
              ? error.message
              : 'Failed to analyze ad performance.',
        },
      };
    }
  },
});
