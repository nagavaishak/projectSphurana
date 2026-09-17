import {
  type CampaignInsightsTotals,
  metaCampaignInsightsSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { ApiFetchError, defineTool } from '../../tool-factory/index.js';
import {
  RANGE_PRESETS,
  resolveToolRangePreset,
} from '../_shared/resolve-tool-date.js';

const safeExternalId = z.string().regex(/^[\w-]+$/, 'Invalid ID format');

interface AdsBreakdownEntry {
  adId: string;
  adName: string;
  spend: number;
  reach: number;
  clicks: number;
  impressions: number;
  ctr: number;
  cpc: number;
}

interface GetCampaignInsightsOutput {
  metaCampaignId: string;
  dateRange?: { since: string; until: string };
  totals?: CampaignInsightsTotals & {
    cpl: number | null;
    cpa: number | null;
  };
  ads?: AdsBreakdownEntry[];
  error?: string;
}

/**
 * `meta_ads_getCampaignInsights` — aggregate performance for a campaign.
 *
 * Ported from the legacy `getCampaignInsights` tool (`ad-tools.ts`).
 * Read-only.
 */
export const getCampaignInsightsTool = defineTool<
  {
    metaCampaignId: string;
    datePreset?: (typeof RANGE_PRESETS)[number];
    dateRange?: { since: string; until: string };
  },
  GetCampaignInsightsOutput
>({
  feature: 'meta-ads',
  action: 'getCampaignInsights',
  description:
    'Get aggregate performance metrics for an entire Meta campaign. Returns ' +
    'total spend, reach, clicks, leads, CTR, CPL, CPA, and per-ad breakdown. ' +
    'For relative windows ("this week", "last 7 days") pass `datePreset` and ' +
    'let the server resolve the dates — never compute a date range yourself.',
  inputSchema: z.object({
    metaCampaignId: safeExternalId.describe('The Meta campaign ID'),
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
  presentation: { statusLabel: 'Loading campaign insights' },
  execute: async ({ metaCampaignId, datePreset, dateRange }, ctx) => {
    try {
      // Phase 3: resolve a relative preset server-side (register #193 — "this
      // week" was computed against the model's 2025 training prior). An
      // explicit dateRange wins if both are set.
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

      const { totals, ads } = data;

      const cpl =
        totals.leads > 0 ? Math.round(totals.spend / totals.leads) : null;
      const cpa =
        totals.conversions > 0
          ? Math.round(totals.spend / totals.conversions)
          : null;

      return {
        data: {
          metaCampaignId,
          // Echo the resolved absolute window so a misresolved preset is
          // visible and assertable (the resolved range wins over the API echo).
          dateRange: resolvedRange ?? data.dateRange,
          totals: {
            ...totals,
            cpl,
            cpa,
          },
          ads: ads.map((a) => ({
            adId: a.adId,
            adName: a.adName,
            spend: a.spend,
            reach: a.reach,
            clicks: a.clicks,
            impressions: a.impressions,
            ctr: a.ctr,
            cpc: a.cpc,
          })),
        },
      };
    } catch (error) {
      const isExpectedClientError =
        error instanceof ApiFetchError &&
        error.status >= 400 &&
        error.status < 500;
      if (!isExpectedClientError) {
        ctx.reportIssue('Failed to load campaign insights', { error });
      }
      return {
        data: {
          metaCampaignId,
          error:
            error instanceof Error
              ? error.message
              : 'Failed to get campaign insights.',
        },
      };
    }
  },
});
