import { withOrgScope } from '@borradh-workspace/database';
import { MetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import { trackedResult } from '@borradh-workspace/observability';
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
import type { CampaignInsights } from '../get-campaign-insights/get-campaign-insights.service.js';
import {
  type ListCampaignsInsightsInput,
  listCampaignsInsightsSchema,
} from './list-campaigns-insights.schema.js';

/** Per-campaign aggregate totals — same shape as `CampaignInsights.totals`. */
export type CampaignInsightsTotals = CampaignInsights['totals'];

/** Insights for a single campaign, keyed by its Meta campaign ID. */
export interface CampaignInsightsSummary {
  metaCampaignId: string;
  totals: CampaignInsightsTotals;
}

/** Batched insights response — one entry per campaign with delivery. */
export interface ListCampaignsInsightsData {
  dateRange: {
    since: string;
    until: string;
  };
  insights: CampaignInsightsSummary[];
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
const listCampaignsInsightsImpl = async (
  db: DbConnection,
  input: ListCampaignsInsightsInput
): Promise<Result<ListCampaignsInsightsData>> => {
  const parsed = listCampaignsInsightsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, dateRange: inputDateRange } = parsed.data;
  const dateRange = inputDateRange || getDefaultDateRange();

  const credResult = await getMetaCredentials(db, { organizationId });
  if (!credResult.success) return credResult;

  const metaService = new MetaAdsService(credResult.data.credentials);

  try {
    // One account-level call returns insights for every campaign at once.
    // Campaigns with no delivery in the window are absent from the response.
    const rows = await metaService.getAccountCampaignInsights(dateRange);

    const insights: CampaignInsightsSummary[] = rows
      .map((row) => {
        // Meta returns the campaign id as snake_case `campaign_id`.
        const metaCampaignId =
          ((row as Record<string, unknown>).campaign_id as string) || '';
        return {
          metaCampaignId,
          totals: {
            impressions: parseNumber(row.impressions),
            reach: parseNumber(row.reach),
            clicks: parseNumber(row.clicks),
            spend: parseSpendToCents(row.spend),
            cpc: parseSpendToCents(row.cpc),
            cpm: parseSpendToCents(row.cpm),
            ctr: parseNumber(row.ctr),
            frequency: parseNumber(row.frequency),
            leads: getActionValue(row.actions, 'lead'),
            conversions: getActionValue(row.actions, 'omni_purchase'),
          },
        };
      })
      .filter((entry) => entry.metaCampaignId !== '');

    return ok({ dateRange, insights });
  } catch (error) {
    return handleMetaError(error, {
      operationName: 'metaCampaigns.listCampaignsInsights',
      defaultErrorCode: CampaignErrorCodes.META_SYNC_FAILED,
      defaultUserTitle: 'Failed to Fetch Insights',
      extra: { organizationId },
      db,
      organizationId,
    });
  }
};

/**
 * List insights for every campaign in an organization's ad account using a
 * single batched Meta API call (`/act_<id>/insights?level=campaign`).
 *
 * This is the rate-limit-safe replacement for calling `getCampaignInsights`
 * once per campaign — the advertising list page would otherwise fire N
 * parallel Meta requests on every page load.
 */
export const listCampaignsInsights = (
  db: DbConnection,
  input: ListCampaignsInsightsInput
) =>
  trackedResult(
    'metaCampaigns.listCampaignsInsights',
    () => withOrgScope((tx) => listCampaignsInsightsImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type ListCampaignsInsightsResult = Awaited<
  ReturnType<typeof listCampaignsInsights>
>;
