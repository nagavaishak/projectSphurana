import { randomUUID } from 'node:crypto';
import {
  metaCampaignConfig,
  metaCampaignDailyInsights,
} from '@borradh-workspace/database';
import { MetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import {
  createLogger,
  trackOrgEvent,
  trackedResult,
} from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { logMetaErrorIfUnknown } from '../../../meta-ads/services/_shared/handle-meta-error.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  convertToUsdCents,
  getExchangeRates,
} from '../../../shared/services/index.js';
import { getMetaCredentials } from '../_shared/index.js';
import {
  type SyncCampaignInsightsInput,
  syncCampaignInsightsSchema,
} from './sync-campaign-insights.schema.js';

const logger = createLogger('SyncCampaignInsights');

export interface SyncResult {
  synced: number;
  failed: number;
  skipped: number;
}

const parseNumber = (value: string | undefined): number => {
  if (!value) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const parseSpendToCents = (value: string | undefined): number => {
  const dollars = parseNumber(value);
  return Math.round(dollars * 100);
};

// Meta NEVER reports lead-gen results under a literal `lead` action type — the
// previous lookup for `'lead'` / `'omni_purchase'` silently resolved to 0 for
// every campaign, which is why stored leads/conversions were uniformly zero.
//
// The real action type depends on the campaign's optimization goal. Meta also
// returns BOTH grouped and ungrouped variants for the same lead, so summing all
// of them double-counts. We take the highest-priority present type per family
// instead, then add messaging conversations (a separate, non-overlapping family
// used by click-to-Messenger / chatbot campaigns).
const LEAD_FORM_ACTION_TYPES = [
  'onsite_conversion.lead_grouped',
  'leadgen.other',
  'leadgen_grouped',
  'lead',
] as const;

const MESSAGING_LEAD_ACTION_TYPES = [
  'onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.total_messaging_connection',
] as const;

const CONVERSION_ACTION_TYPES = [
  'offsite_conversion.fb_pixel_purchase',
  'onsite_conversion.purchase',
  'omni_purchase',
  'purchase',
] as const;

type MetaAction = { actionType: string; value: string };

const buildActionMap = (
  actions: MetaAction[] | undefined
): Map<string, number> => {
  const map = new Map<string, number>();
  for (const a of actions ?? []) {
    map.set(a.actionType, Number.parseInt(a.value, 10) || 0);
  }
  return map;
};

// First present type wins, to avoid double-counting grouped/ungrouped variants.
const firstPresentValue = (
  map: Map<string, number>,
  types: readonly string[]
): number => {
  for (const t of types) {
    const v = map.get(t);
    if (v !== undefined) return v;
  }
  return 0;
};

const extractLeads = (map: Map<string, number>): number =>
  firstPresentValue(map, LEAD_FORM_ACTION_TYPES) +
  firstPresentValue(map, MESSAGING_LEAD_ACTION_TYPES);

const extractConversions = (map: Map<string, number>): number =>
  firstPresentValue(map, CONVERSION_ACTION_TYPES);

function getYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

const syncCampaignInsightsImpl = async (
  db: DbConnection,
  input: SyncCampaignInsightsInput
): Promise<Result<SyncResult>> => {
  const parsed = syncCampaignInsightsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;
  const syncDate = parsed.data.date ?? getYesterday();
  const dateRange = { since: syncDate, until: syncDate };

  // Fetch exchange rates (cached, one call per sync run)
  const rates = await getExchangeRates();
  if (!rates) {
    logger.warn('Could not fetch exchange rates, USD conversion will be 0', {
      organizationId,
    });
  }

  // Get all campaigns for this org
  const campaigns = await db.query.metaCampaignConfig.findMany({
    where: eq(metaCampaignConfig.organizationId, organizationId),
    columns: {
      metaCampaignId: true,
      metaAdsPageId: true,
      adAccountId: true,
      adAccountCurrency: true,
    },
  });

  if (campaigns.length === 0) {
    return ok({ synced: 0, failed: 0, skipped: 0 });
  }

  let synced = 0;
  let failed = 0;
  let skipped = 0;

  for (const campaign of campaigns) {
    try {
      const currency = campaign.adAccountCurrency ?? 'USD';

      const credResult = await getMetaCredentials(db, {
        organizationId,
        metaAdsPageId: campaign.metaAdsPageId ?? undefined,
        adAccountId: campaign.adAccountId ?? undefined,
      });

      if (!credResult.success) {
        skipped++;
        continue;
      }

      const metaService = new MetaAdsService(credResult.data.credentials);

      // Get campaign-level aggregate insights
      const aggregateInsights = await metaService.getCampaignAggregateInsights(
        campaign.metaCampaignId,
        dateRange
      );

      if (!aggregateInsights) {
        skipped++;
        continue;
      }

      const spend = parseSpendToCents(aggregateInsights.spend);

      // Skip days with zero spend (no data to store)
      if (spend === 0) {
        skipped++;
        continue;
      }

      // Map Meta's actions[] once; reused for leads + conversions below.
      const actionMap = buildActionMap(aggregateInsights.actions);

      // Diagnostic: spend exists but nothing matched our lead action types —
      // log the raw types so we can confirm the correct mapping per objective
      // (especially on staging with a real connected org). Remove once verified.
      if (
        extractLeads(actionMap) === 0 &&
        (aggregateInsights.actions?.length ?? 0) > 0
      ) {
        logger.info('campaign insights: spend with unmapped lead actions', {
          organizationId,
          metaCampaignId: campaign.metaCampaignId,
          actionTypes: (aggregateInsights.actions ?? []).map(
            (a) => a.actionType
          ),
        });
      }

      const cpc = parseSpendToCents(aggregateInsights.cpc);
      const cpm = parseSpendToCents(aggregateInsights.cpm);

      // Convert to USD
      const spendUsdResult = rates
        ? convertToUsdCents(spend, currency, rates)
        : null;
      const cpcUsdResult = rates
        ? convertToUsdCents(cpc, currency, rates)
        : null;
      const cpmUsdResult = rates
        ? convertToUsdCents(cpm, currency, rates)
        : null;

      const row = {
        organizationId,
        metaCampaignId: campaign.metaCampaignId,
        metaAdId: null,
        date: new Date(syncDate),
        spend,
        currency,
        cpc,
        cpm,
        spendUsd: spendUsdResult?.usdCents ?? 0,
        cpcUsd: cpcUsdResult?.usdCents ?? null,
        cpmUsd: cpmUsdResult?.usdCents ?? null,
        exchangeRate: spendUsdResult?.rateUsed ?? null,
        impressions: parseNumber(aggregateInsights.impressions),
        reach: parseNumber(aggregateInsights.reach),
        clicks: parseNumber(aggregateInsights.clicks),
        leads: extractLeads(actionMap),
        conversions: extractConversions(actionMap),
        ctr: aggregateInsights.ctr ?? null,
        frequency: aggregateInsights.frequency ?? null,
      };

      // Upsert (unique on metaCampaignId + metaAdId + date)
      const existing = await db.query.metaCampaignDailyInsights.findFirst({
        where: (t, { and, eq, isNull }) =>
          and(
            eq(t.metaCampaignId, campaign.metaCampaignId),
            isNull(t.metaAdId),
            eq(t.date, new Date(syncDate))
          ),
      });

      if (existing) {
        await db
          .update(metaCampaignDailyInsights)
          .set(row)
          .where(eq(metaCampaignDailyInsights.id, existing.id));
      } else {
        await db.insert(metaCampaignDailyInsights).values({
          id: randomUUID(),
          ...row,
        });
      }

      // Fire PostHog event
      trackOrgEvent(organizationId, 'ad_daily_metrics', {
        organizationId,
        metaCampaignId: campaign.metaCampaignId,
        date: syncDate,
        spend,
        currency,
        cpc,
        cpm,
        spendUsd: spendUsdResult?.usdCents ?? 0,
        cpcUsd: cpcUsdResult?.usdCents ?? null,
        cpmUsd: cpmUsdResult?.usdCents ?? null,
        impressions: row.impressions,
        reach: row.reach,
        clicks: row.clicks,
        leads: row.leads,
        conversions: row.conversions,
        ctr: row.ctr,
        frequency: row.frequency,
      });

      synced++;
    } catch (error) {
      failed++;
      logMetaErrorIfUnknown(
        'metaCampaigns.syncCampaignInsights.campaign',
        error,
        { organizationId, metaCampaignId: campaign.metaCampaignId }
      );
    }
  }

  logger.info('Campaign insights sync complete', {
    organizationId,
    syncDate,
    synced,
    failed,
    skipped,
  });

  return ok({ synced, failed, skipped });
};

export const syncCampaignInsights = (
  db: DbConnection,
  input: SyncCampaignInsightsInput
) =>
  trackedResult(
    'metaCampaigns.syncCampaignInsights',
    () => syncCampaignInsightsImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type SyncCampaignInsightsResult = Awaited<
  ReturnType<typeof syncCampaignInsights>
>;
