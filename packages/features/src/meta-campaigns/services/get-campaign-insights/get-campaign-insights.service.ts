import { metaCampaignConfig, withOrgScope } from '@borradh-workspace/database';
import { MetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import type { MetaInsightsData } from '@borradh-workspace/integrations/meta-ads';
import { trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { handleMetaError } from '../../../meta-ads/services/_shared/handle-meta-error.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { CampaignErrorCodes } from '../../models/index.js';
import { getMetaCredentials } from '../_shared/index.js';
import {
  type GetCampaignInsightsInput,
  getCampaignInsightsSchema,
} from './get-campaign-insights.schema.js';

/**
 * Campaign insights response
 */
export interface CampaignInsights {
  metaCampaignId: string;
  dateRange: {
    since: string;
    until: string;
  };
  totals: {
    impressions: number;
    reach: number;
    clicks: number;
    spend: number; // in cents
    cpc: number; // in cents
    cpm: number; // in cents
    ctr: number; // percentage
    frequency: number;
    leads: number;
    conversions: number;
  };
  ads: Array<{
    adId: string;
    adName: string;
    impressions: number;
    reach: number;
    clicks: number;
    spend: number;
    cpc: number;
    cpm: number;
    ctr: number;
  }>;
}

const getDefaultDateRange = () => {
  const until = new Date();
  const since = new Date();
  since.setDate(since.getDate() - 30);
  return {
    since: since.toISOString().split('T')[0],
    until: until.toISOString().split('T')[0],
  };
};

const parseNumber = (value: string | undefined): number => {
  if (!value) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const parseSpendToCents = (value: string | undefined): number => {
  const dollars = parseNumber(value);
  return Math.round(dollars * 100);
};

const getActionValue = (
  actions: Array<{ actionType: string; value: string }> | undefined,
  actionType: string
): number => {
  if (!actions) return 0;
  const action = actions.find((a) => a.actionType === actionType);
  return action ? Number.parseInt(action.value, 10) : 0;
};

/**
 * Internal implementation
 */
const getCampaignInsightsImpl = async (
  db: DbConnection,
  input: GetCampaignInsightsInput
): Promise<Result<CampaignInsights>> => {
  const parsed = getCampaignInsightsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    metaCampaignId,
    organizationId,
    dateRange: inputDateRange,
  } = parsed.data;
  const dateRange = inputDateRange || getDefaultDateRange();

  // Look up campaign config for page + ad account resolution
  const campaignConfig = await db.query.metaCampaignConfig.findFirst({
    where: eq(metaCampaignConfig.metaCampaignId, metaCampaignId),
  });

  const credResult = await getMetaCredentials(db, {
    organizationId,
    metaAdsPageId: campaignConfig?.metaAdsPageId ?? undefined,
    adAccountId: campaignConfig?.adAccountId ?? undefined,
  });
  if (!credResult.success) return credResult;

  const metaService = new MetaAdsService(credResult.data.credentials);

  try {
    const [aggregateInsights, adInsights] = await Promise.all([
      metaService.getCampaignAggregateInsights(metaCampaignId, dateRange),
      metaService.getCampaignInsights(metaCampaignId, dateRange),
    ]);

    const totals = {
      impressions: parseNumber(aggregateInsights?.impressions),
      reach: parseNumber(aggregateInsights?.reach),
      clicks: parseNumber(aggregateInsights?.clicks),
      spend: parseSpendToCents(aggregateInsights?.spend),
      cpc: parseSpendToCents(aggregateInsights?.cpc),
      cpm: parseSpendToCents(aggregateInsights?.cpm),
      ctr: parseNumber(aggregateInsights?.ctr),
      frequency: parseNumber(aggregateInsights?.frequency),
      leads: getActionValue(aggregateInsights?.actions, 'lead'),
      conversions: getActionValue(aggregateInsights?.actions, 'omni_purchase'),
    };

    // Meta API returns snake_case keys; cast to access raw fields
    const ads = adInsights.map((insight: MetaInsightsData) => {
      const raw = insight as Record<string, unknown>;
      return {
        adId: (raw.ad_id as string) || '',
        adName: (raw.ad_name as string) || '',
        impressions: parseNumber(insight.impressions),
        reach: parseNumber(insight.reach),
        clicks: parseNumber(insight.clicks),
        spend: parseSpendToCents(insight.spend),
        cpc: parseSpendToCents(insight.cpc),
        cpm: parseSpendToCents(insight.cpm),
        ctr: parseNumber(insight.ctr),
      };
    });

    return ok({
      metaCampaignId,
      dateRange,
      totals,
      ads,
    });
  } catch (error) {
    return handleMetaError(error, {
      operationName: 'metaCampaigns.getCampaignInsights',
      defaultErrorCode: CampaignErrorCodes.META_SYNC_FAILED,
      defaultUserTitle: 'Failed to Fetch Insights',
      extra: { metaCampaignId, organizationId },
      db,
      organizationId,
    });
  }
};

/**
 * Get campaign insights directly from Meta Ads API.
 */
export const getCampaignInsights = (
  db: DbConnection,
  input: GetCampaignInsightsInput
) =>
  trackedResult(
    'metaCampaigns.getCampaignInsights',
    () => withOrgScope((tx) => getCampaignInsightsImpl(tx, input), { db }),
    {
      properties: { metaCampaignId: input.metaCampaignId },
      internalErrorsOnly: true,
    }
  );

export type GetCampaignInsightsResult = Awaited<
  ReturnType<typeof getCampaignInsights>
>;
