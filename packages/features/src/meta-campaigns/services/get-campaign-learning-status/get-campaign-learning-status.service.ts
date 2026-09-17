import {
  metaCampaignConfig,
  metaCampaignDailyInsights,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq, sql } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type GetCampaignLearningStatusInput,
  getCampaignLearningStatusSchema,
} from './get-campaign-learning-status.schema.js';

/**
 * Meta's optimisation algorithm spends roughly 7–10 days "learning" a fresh
 * campaign — feeding it impressions, sampling audiences, optimising bids.
 * Changing the campaign during that window (pausing, scaling the budget,
 * adding/removing ads) resets the learning clock and wastes the algorithm's
 * progress. Claire treats day 10 as the exit boundary; this lookup answers
 * "is this campaign still inside that window?".
 *
 * Critically, Meta's learning phase only *begins* once a campaign starts
 * DELIVERING (first impressions / spend). A campaign that Borradh created but
 * that hasn't served an impression yet is NOT in learning — there's no learning
 * progress to reset, so editing it (e.g. correcting a just-set daily budget) is
 * safe. We therefore gate `isInLearningPhase` on actual delivery in addition to
 * the day-10 window: the age of `createdAt` alone is not sufficient.
 *
 * Used by:
 *   - The `noLiveCampaignChangeDuringLearningPhase` hard-block validator
 *     (`apps/api/src/assistant/tool-factory/hard-blocks.ts`)
 *   - The `noScalingBeforeLearningExits` hard-block validator (same)
 *   - Reusable by any future UI that wants to surface learning state.
 */
export interface CampaignLearningStatus {
  metaCampaignId: string;
  organizationId: string;
  /** ISO-8601 string. Comes from `metaCampaignConfig.createdAt` — the moment
   *  Borradh created the campaign on Meta. We treat it as the launch date. */
  launchedAt: string;
  /** Whole days elapsed since `launchedAt`. Floored. */
  daysSinceLaunch: number;
  /** True when the campaign has served at least one impression (equivalently,
   *  recorded any spend) per `metaCampaignDailyInsights`. Delivery is what
   *  actually starts Meta's learning clock — a campaign that has never
   *  delivered has no learning progress to protect. */
  hasStartedDelivering: boolean;
  /** True only when the campaign has started delivering AND `daysSinceLaunch
   *  < 10`. A campaign that has never delivered is NOT in the learning phase,
   *  regardless of how long ago it was created — so edits are allowed. */
  isInLearningPhase: boolean;
}

const LEARNING_PHASE_DAYS = 10;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const getCampaignLearningStatusImpl = async (
  db: DbConnection,
  input: GetCampaignLearningStatusInput
): Promise<Result<CampaignLearningStatus>> => {
  const parsed = getCampaignLearningStatusSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, metaCampaignId } = parsed.data;

  const config = await db.query.metaCampaignConfig.findFirst({
    where: and(
      eq(metaCampaignConfig.metaCampaignId, metaCampaignId),
      eq(metaCampaignConfig.organizationId, organizationId)
    ),
    columns: {
      metaCampaignId: true,
      organizationId: true,
      createdAt: true,
    },
  });

  if (!config) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Campaign not found'));
  }

  // Has the campaign actually started delivering? Meta's learning phase only
  // begins on first delivery, so a freshly-created campaign with no impressions
  // is not in learning even if it was created today. Aggregate in the DB rather
  // than loading rows — one row back, keyed by SUM over this campaign's daily
  // insights. Org scope is enforced both by `withOrgScope`'s RLS tx and the
  // explicit organizationId predicate.
  const [delivery] = await db
    .select({
      totalImpressions: sql<number>`coalesce(sum(${metaCampaignDailyInsights.impressions}), 0)`,
    })
    .from(metaCampaignDailyInsights)
    .where(
      and(
        eq(metaCampaignDailyInsights.metaCampaignId, metaCampaignId),
        eq(metaCampaignDailyInsights.organizationId, organizationId)
      )
    );

  // `sum` comes back as a numeric string (or null when no rows); coalesce keeps
  // it 0-or-positive but Number() guards the string-vs-number ambiguity.
  const totalImpressions = Number(delivery?.totalImpressions ?? 0);
  const hasStartedDelivering = totalImpressions > 0;

  const launchedAt = config.createdAt;
  const elapsedMs = Date.now() - launchedAt.getTime();
  const daysSinceLaunch = Math.max(0, Math.floor(elapsedMs / MS_PER_DAY));
  const isInLearningPhase =
    hasStartedDelivering && daysSinceLaunch < LEARNING_PHASE_DAYS;

  return ok({
    metaCampaignId: config.metaCampaignId,
    organizationId: config.organizationId,
    launchedAt: launchedAt.toISOString(),
    daysSinceLaunch,
    hasStartedDelivering,
    isInLearningPhase,
  });
};

export const getCampaignLearningStatus = (
  db: DbConnection,
  input: GetCampaignLearningStatusInput
) =>
  trackedResult(
    'metaCampaigns.getCampaignLearningStatus',
    () =>
      withOrgScope((tx) => getCampaignLearningStatusImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        metaCampaignId: input.metaCampaignId,
      },
      internalErrorsOnly: true,
    }
  );

export type GetCampaignLearningStatusResult = Awaited<
  ReturnType<typeof getCampaignLearningStatus>
>;
