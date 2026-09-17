import {
  businessProfile,
  metaAd,
  metaAdService,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { eq, sql } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { getTroubleshootState } from '../get-troubleshoot-state/index.js';
import {
  SPEND_THRESHOLD_EUR,
  getHighIntentConversationStats,
  hasSpentEnough,
} from '../shared/index.js';
import {
  type BudgetBand,
  type CampaignDiagnosis,
  type DiagnoseCampaignInput,
  type ServiceTier,
  diagnoseCampaignSchema,
} from './diagnose-campaign.schema.js';

/**
 * Tier ≈ offerStrategy map (framework decision: data-derived strategy wins
 * over the doc's hardcoded tier table).
 *   T1 — price_visible_intro     (show price, intro discount)
 *   T2 — switch_service / price_hidden_conversation (mid-trust)
 *   T3 — consultation_led / do_not_advertise (surgical / consultation-led)
 */
const TIER_BY_OFFER_STRATEGY: Record<string, ServiceTier> = {
  price_visible_intro: 1,
  switch_service: 2,
  price_hidden_conversation: 2,
  consultation_led: 3,
  do_not_advertise: 3,
};

function budgetBandFromDailyCents(
  avgDailyCents: number | null
): BudgetBand | null {
  if (avgDailyCents == null) return null;
  if (avgDailyCents < 1000) return 'below_10';
  if (avgDailyCents < 2000) return '10_to_19';
  return '20_plus';
}

function roundsTriedFrom(
  currentRound: 'none' | 'offer_adjusted' | 'creative_refreshed'
): number {
  if (currentRound === 'creative_refreshed') return 2;
  if (currentRound === 'offer_adjusted') return 1;
  return 0;
}

interface InsightAggregateRow {
  spendCents: number | string | null;
  spendUsdCents: number | string | null;
  daysWithData: number | string | null;
  currency: string | null;
  [key: string]: unknown;
}

interface ServiceIdRow {
  serviceId: string;
  [key: string]: unknown;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const diagnoseCampaignImpl = async (
  db: DbConnection,
  input: DiagnoseCampaignInput
): Promise<Result<CampaignDiagnosis>> => {
  const parsed = diagnoseCampaignSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, metaCampaignId } = parsed.data;
  const windowDays = parsed.data.windowDays ?? 30;

  try {
    // --- Spend / insight aggregation (campaign-level rows only) ---
    const insightResult = await db.execute(sql<InsightAggregateRow[]>`
      SELECT
        COALESCE(SUM(${sql.raw('spend')})::int, 0)               AS "spendCents",
        COALESCE(SUM(${sql.raw('spend_usd')})::int, 0)           AS "spendUsdCents",
        COUNT(DISTINCT ${sql.raw('date')}::date)::int            AS "daysWithData",
        MAX(${sql.raw('currency')})                              AS "currency"
      FROM ${sql.raw('meta_campaign_daily_insights')}
      WHERE ${sql.raw('organization_id')} = ${organizationId}
        AND ${sql.raw('meta_campaign_id')} = ${metaCampaignId}
        AND ${sql.raw('meta_ad_id')} IS NULL
        AND ${sql.raw('date')} >= NOW() - INTERVAL '${sql.raw(String(windowDays))} days'
    `);

    const aggRows = (insightResult as unknown as InsightAggregateRow[]) ?? [];
    const agg = aggRows[0] ?? {
      spendCents: 0,
      spendUsdCents: 0,
      daysWithData: 0,
      currency: null,
    };
    const spendCents = Number(agg.spendCents) || 0;
    const spendUsdCents = Number(agg.spendUsdCents) || 0;
    const daysWithData = Number(agg.daysWithData) || 0;
    const avgDailySpendCents =
      daysWithData > 0 ? Math.round(spendCents / daysWithData) : null;

    // --- High-intent leads (shared predicate) ---
    const intent = await getHighIntentConversationStats(db, {
      organizationId,
      metaCampaignId,
    });
    const daysSinceLastHighIntentLead = intent.lastHighIntentAt
      ? Math.floor((Date.now() - intent.lastHighIntentAt.getTime()) / DAY_MS)
      : null;

    // --- Service tier from offerStrategy (data-derived, NOT a new column) ---
    const serviceRows = await db.execute(sql<ServiceIdRow[]>`
      SELECT DISTINCT ${metaAdService.serviceId} AS "serviceId"
      FROM ${metaAdService}
      JOIN ${metaAd} ON ${metaAd.id} = ${metaAdService.metaAdId}
      WHERE ${metaAd.organizationId} = ${organizationId}
        AND ${metaAd.metaCampaignId} = ${metaCampaignId}
    `);
    const campaignServiceIds = new Set(
      ((serviceRows as unknown as ServiceIdRow[]) ?? []).map((r) => r.serviceId)
    );

    let offerStrategy: string | null = null;
    let serviceTier: ServiceTier | null = null;
    if (campaignServiceIds.size > 0) {
      const profile = await db.query.businessProfile.findFirst({
        where: eq(businessProfile.organizationId, organizationId),
      });
      const ranked = (profile?.rankedServices ?? [])
        .filter((r) => campaignServiceIds.has(r.serviceId))
        .sort((a, b) => a.rank - b.rank);
      const best = ranked[0];
      if (best) {
        offerStrategy = best.offerStrategy;
        serviceTier = TIER_BY_OFFER_STRATEGY[best.offerStrategy] ?? null;
      }
    }

    // --- Lifecycle state (Task 2) ---
    const stateResult = await getTroubleshootState(db, {
      organizationId,
      metaCampaignId,
    });
    const state = stateResult.success ? stateResult.data : null;
    const currentRound = state?.currentRound ?? 'none';

    const diagnosis: CampaignDiagnosis = {
      metaCampaignId,
      windowDays,
      spendCents,
      spendUsdCents,
      currency: agg.currency ?? null,
      spentEnough: hasSpentEnough(spendUsdCents),
      spendThresholdEur: SPEND_THRESHOLD_EUR,
      highIntentLeadCount: intent.highIntentCount,
      daysSinceLastHighIntentLead,
      serviceTier,
      offerStrategy,
      budgetBand: budgetBandFromDailyCents(avgDailySpendCents),
      avgDailySpendCents,
      currentRound,
      roundsTried: roundsTriedFrom(currentRound),
      escalated: state?.escalatedAt != null,
      lastDiagnosedAt: state?.lastDiagnosedAt
        ? state.lastDiagnosedAt.toISOString()
        : null,
    };

    return ok(diagnosis);
  } catch {
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to diagnose campaign')
    );
  }
};

export const diagnoseCampaign = (
  db: DbConnection,
  input: DiagnoseCampaignInput
) =>
  trackedResult(
    'metaCampaigns.diagnoseCampaign',
    () => diagnoseCampaignImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        metaCampaignId: input.metaCampaignId,
      },
      internalErrorsOnly: true,
    }
  );

export type DiagnoseCampaignResult = Awaited<
  ReturnType<typeof diagnoseCampaign>
>;
