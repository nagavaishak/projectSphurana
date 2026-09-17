import { organizationIntegration } from '@borradh-workspace/database';
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import {
  type MetaAdsCredentials,
  MetaAdsService,
  type MetaInsightsData,
} from '@borradh-workspace/integrations/meta-ads';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type AdAnalysis,
  type DailyInsight,
  PRIORITY_ORDER,
  type Recommendation,
  type RecommendationsResult,
} from '../../models/index.js';
import { detectBurnout } from './analyzers/burnout-detector.js';
import { analyzeCpl, getCplRating } from './analyzers/cpl-analyzer.js';
import {
  analyzeLearningPhase,
  isInLearningPhase,
} from './analyzers/learning-phase.js';
import {
  type GetRecommendationsInput,
  getRecommendationsSchema,
} from './get-recommendations.schema.js';

/**
 * Parse numeric string to number, defaulting to 0
 */
const parseNumber = (value: string | undefined): number => {
  if (!value) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

/**
 * Extract lead count from actions array
 */
const getLeadCount = (
  actions: Array<{ actionType: string; value: string }> | undefined
): number => {
  if (!actions) return 0;
  const leadAction = actions.find((a) => a.actionType === 'lead');
  return leadAction ? Number.parseInt(leadAction.value, 10) : 0;
};

/**
 * Get date range string for Meta API
 */
const getDateRange = (days: number): { since: string; until: string } => {
  const until = new Date();
  const since = new Date();
  since.setDate(since.getDate() - days);

  return {
    since: since.toISOString().split('T')[0],
    until: until.toISOString().split('T')[0],
  };
};

/**
 * Transform Meta insights to DailyInsight format
 */
const transformInsights = (insights: MetaInsightsData[]): DailyInsight[] => {
  return insights.map((insight) => {
    const spend = parseNumber(insight.spend);
    const leads = getLeadCount(insight.actions);
    const cpl = leads > 0 ? spend / leads : null;

    return {
      date: insight.dateStart || '',
      spend,
      impressions: parseNumber(insight.impressions),
      clicks: parseNumber(insight.clicks),
      leads,
      cpl,
      ctr: parseNumber(insight.ctr),
      frequency: parseNumber(insight.frequency),
    };
  });
};

/**
 * Analyze an ad and return recommendations
 */
const analyzeAd = (analysis: AdAnalysis): Recommendation[] => {
  const recommendations: Recommendation[] = [];

  // If learning, only show learning phase recommendation
  if (analysis.isLearning) {
    recommendations.push(...analyzeLearningPhase(analysis));
    return recommendations;
  }

  // Run all analyzers
  recommendations.push(...analyzeCpl(analysis));
  recommendations.push(...detectBurnout(analysis));

  return recommendations;
};

/**
 * Internal implementation
 */
const getRecommendationsImpl = async (
  db: DbConnection,
  input: GetRecommendationsInput
): Promise<Result<RecommendationsResult>> => {
  // Validate input
  const parsed = getRecommendationsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, days, limit } = parsed.data;

  // Get Meta integration credentials
  const integration = await db.query.organizationIntegration.findFirst({
    where: and(
      eq(organizationIntegration.organizationId, organizationId),
      eq(organizationIntegration.type, 'facebook_ads'),
      eq(organizationIntegration.isActive, true)
    ),
  });

  if (!integration || !integration.encryptedCredentials) {
    // No Meta integration - return empty recommendations
    return ok({
      recommendations: [],
      analyzedAdsCount: 0,
      hasMetaIntegration: false,
    });
  }

  // Decrypt credentials
  let credentials: MetaAdsCredentials;
  try {
    credentials = decryptCredentials<MetaAdsCredentials>(
      integration.encryptedCredentials
    );
  } catch (error) {
    logError('recommendations.getRecommendations', error, {
      feature: 'recommendations',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to decrypt Meta credentials'
      )
    );
  }

  const metaService = new MetaAdsService(credentials);
  const dateRange = getDateRange(days);
  const allRecommendations: Recommendation[] = [];
  let analyzedAdsCount = 0;

  try {
    // Get active ads from Meta
    const activeAds = await metaService.listActiveAds();

    // Process each active ad
    for (const ad of activeAds) {
      try {
        // Get daily insights for this ad
        const dailyInsightsRaw = await metaService.getAdInsightsDaily(
          ad.id,
          dateRange
        );

        // Get aggregate insights for totals
        const aggregateInsights = await metaService.getAdInsights(
          ad.id,
          dateRange
        );

        const dailyInsights = transformInsights(dailyInsightsRaw);
        const totalSpend = parseNumber(aggregateInsights?.spend);
        const totalLeads = getLeadCount(aggregateInsights?.actions);
        const averageCpl = totalLeads > 0 ? totalSpend / totalLeads : null;
        const currentFrequency = parseNumber(aggregateInsights?.frequency);

        // Build analysis object
        const analysis: AdAnalysis = {
          adId: ad.id,
          adName: ad.name,
          campaignId: ad.campaignId || '',
          campaignName: ad.campaignName || '',
          totalSpend,
          totalLeads,
          averageCpl,
          currentFrequency,
          dailyInsights,
          isLearning: isInLearningPhase(totalSpend),
          cplRating: getCplRating(averageCpl),
        };

        // Analyze and get recommendations
        const adRecommendations = analyzeAd(analysis);
        allRecommendations.push(...adRecommendations);
        analyzedAdsCount++;
      } catch (error) {
        // Log error but continue with other ads
        logError('recommendations.getRecommendations.analyzeAd', error, {
          feature: 'recommendations',
          extra: { organizationId, adId: ad.id },
        });
      }
    }

    // Sort recommendations by priority
    allRecommendations.sort((a, b) => {
      return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    });

    // Limit results
    const limitedRecommendations = allRecommendations.slice(0, limit);

    return ok({
      recommendations: limitedRecommendations,
      analyzedAdsCount,
      hasMetaIntegration: true,
    });
  } catch (error) {
    logError('recommendations.getRecommendations', error, {
      feature: 'recommendations',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        `Failed to fetch recommendations: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    );
  }
};

/**
 * Get AI recommendations for Meta Ads performance
 *
 * Analyzes active ads and returns prioritized recommendations based on:
 * - CPL performance (scale opportunities, concerning costs)
 * - Learning phase detection
 * - Ad burnout/fatigue indicators
 *
 * @param db - Database connection
 * @param input - Organization ID and optional parameters
 * @returns Result with recommendations sorted by priority
 *
 * @example
 * ```ts
 * const result = await getRecommendations(db, {
 *   organizationId: 'org-123',
 *   days: 7,
 *   limit: 10,
 * });
 *
 * if (result.success) {
 *   for (const rec of result.data.recommendations) {
 *     console.log(`${rec.priority}: ${rec.title}`);
 *   }
 * }
 * ```
 */
export const getRecommendations = (
  db: DbConnection,
  input: GetRecommendationsInput
) =>
  trackedResult(
    'recommendations.getRecommendations',
    () => getRecommendationsImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

/**
 * Result type for getRecommendations
 */
export type GetRecommendationsResult = Awaited<
  ReturnType<typeof getRecommendations>
>;
