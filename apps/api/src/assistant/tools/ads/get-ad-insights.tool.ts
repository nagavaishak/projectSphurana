import { metaCampaignInsightsSchema } from '@borradh-workspace/contracts';
import { z } from 'zod';
import { ApiFetchError, defineTool } from '../../tool-factory/index.js';
import {
  RANGE_PRESETS,
  resolveToolRangePreset,
} from '../_shared/resolve-tool-date.js';

const safeExternalId = z.string().regex(/^[\w-]+$/, 'Invalid ID format');

interface GetAdInsightsOutput {
  metaAdId: string;
  adName?: string;
  dateRange?: { since: string; until: string };
  spend: number;
  reach: number;
  clicks: number;
  impressions?: number;
  ctr: number;
  cpc?: number;
  cpm?: number;
  leads: number;
  conversions?: number;
  cpl: number | null;
  cpa: number | null;
  message?: string;
  note?: string;
  error?: string;
}

/**
 * `meta_ads_getAdInsights` — performance for one ad.
 *
 * Ported from the legacy `getAdInsights` tool (`ad-tools.ts`). Read-only.
 * Lead and conversion attribution at the per-ad level is estimated by
 * spend share — preserved verbatim from the legacy version (Meta only
 * surfaces totals at the campaign level for some metrics).
 */
export const getAdInsightsTool = defineTool<
  {
    metaCampaignId: string;
    metaAdId: string;
    datePreset?: (typeof RANGE_PRESETS)[number];
    dateRange?: { since: string; until: string };
  },
  GetAdInsightsOutput
>({
  feature: 'meta-ads',
  action: 'getAdInsights',
  description:
    'Get performance metrics for a specific ad within a campaign. Returns spend, ' +
    'reach, clicks, leads, CTR, CPL, and CPA. Requires the Meta campaign ID and ' +
    'the Meta ad ID (not the local ad ID). For relative windows ("this week", ' +
    '"last 7 days") pass `datePreset` — never compute a date range yourself.',
  inputSchema: z.object({
    metaCampaignId: safeExternalId.describe(
      'The Meta campaign ID the ad belongs to'
    ),
    metaAdId: safeExternalId.describe('The Meta ad ID to get insights for'),
    datePreset: z
      .enum(RANGE_PRESETS)
      .optional()
      .describe(
        'Relative window resolved server-side in the org timezone from the ' +
          'real clock — one of: today, yesterday, this_week, last_week, ' +
          'last_7_days, last_14_days, last_30_days, this_month, last_month. ' +
          'PREFER this over `dateRange` for any relative phrase; the resolved ' +
          'range is echoed back. Ignored if `dateRange` is also set.'
      ),
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
      .describe(
        'Explicit YYYY-MM-DD range. Only for absolute dates the user named — ' +
          'for relative windows use `datePreset`. Defaults to last 30 days.'
      ),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Loading ad insights' },
  execute: async ({ metaCampaignId, metaAdId, datePreset, dateRange }, ctx) => {
    try {
      // Phase 3: resolve a relative preset server-side in the org timezone.
      // An explicit dateRange wins if both are set.
      const resolvedRange =
        dateRange ??
        (datePreset
          ? resolveToolRangePreset(datePreset, ctx.timezone)
          : undefined);
      const params = new URLSearchParams();
      if (resolvedRange) {
        params.set('since', resolvedRange.since);
        params.set('until', resolvedRange.until);
      }
      const qs = params.toString();

      const data = await ctx.apiFetch(
        `meta-campaigns/${metaCampaignId}/insights${qs ? `?${qs}` : ''}`,
        { schema: metaCampaignInsightsSchema }
      );

      const adInsight = data.ads.find((a) => a.adId === metaAdId);

      if (!adInsight) {
        return {
          data: {
            metaAdId,
            message:
              'No insights data found for this ad. It may be too new or have no delivery.',
            spend: 0,
            reach: 0,
            clicks: 0,
            ctr: 0,
            leads: 0,
            cpl: null,
            cpa: null,
          },
        };
      }

      const totalSpend = data.totals.spend;
      const totalLeads = data.totals.leads;
      const totalConversions = data.totals.conversions;
      const adSpendRatio = totalSpend > 0 ? adInsight.spend / totalSpend : 0;
      const estimatedLeads = Math.round(totalLeads * adSpendRatio);
      const estimatedConversions = Math.round(totalConversions * adSpendRatio);

      const cpl =
        estimatedLeads > 0
          ? Math.round(adInsight.spend / estimatedLeads)
          : null;
      const cpa =
        estimatedConversions > 0
          ? Math.round(adInsight.spend / estimatedConversions)
          : null;

      return {
        data: {
          metaAdId,
          adName: adInsight.adName,
          // Echo the resolved absolute window (resolved range wins over the
          // API echo) so a misresolved preset is visible and assertable.
          dateRange: resolvedRange ?? data.dateRange,
          spend: adInsight.spend,
          reach: adInsight.reach,
          clicks: adInsight.clicks,
          impressions: adInsight.impressions,
          ctr: adInsight.ctr,
          cpc: adInsight.cpc,
          cpm: adInsight.cpm,
          leads: estimatedLeads,
          conversions: estimatedConversions,
          cpl,
          cpa,
          note:
            totalLeads > 0 && data.ads.length > 1
              ? 'Lead/conversion counts are estimated proportionally by spend share.'
              : undefined,
        },
      };
    } catch (error) {
      const isExpectedClientError =
        error instanceof ApiFetchError &&
        error.status >= 400 &&
        error.status < 500;
      if (!isExpectedClientError) {
        ctx.reportIssue('Failed to load ad insights', { error });
      }
      return {
        data: {
          metaAdId,
          spend: 0,
          reach: 0,
          clicks: 0,
          ctr: 0,
          leads: 0,
          cpl: null,
          cpa: null,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to get ad insights.',
        },
      };
    }
  },
});
