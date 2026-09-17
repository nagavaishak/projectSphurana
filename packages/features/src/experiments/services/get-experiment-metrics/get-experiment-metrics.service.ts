import {
  appointment,
  conversation,
  experiment,
  experimentAssignment,
  lead,
  metaAd,
  metaCampaignConfig,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type GetExperimentMetricsInput,
  getExperimentMetricsSchema,
} from './get-experiment-metrics.schema.js';

export interface ExperimentCohort {
  variant: string;
  label: string;
  organizationCount: number;
  campaignCount: number;
  /** Meta campaign IDs for fetching live insights */
  metaCampaignIds: string[];
  /** Number of conversations started from ads in this cohort */
  conversationCount: number;
  /** Number of appointments booked from those conversations */
  bookingCount: number;
  /** Conversation → booking conversion rate (0-1) */
  bookingRate: number | null;
}

export interface ExperimentMetrics {
  experimentId: string;
  experimentKey: string;
  experimentName: string;
  status: string;
  cohorts: ExperimentCohort[];
}

/**
 * Get experiment metrics grouped by variant.
 * Returns campaign IDs per cohort so the caller can fetch live
 * spend/impressions/messages from the Meta API.
 */
const getExperimentMetricsImpl = async (
  db: DbConnection,
  input: GetExperimentMetricsInput
): Promise<Result<ExperimentMetrics>> => {
  const parsed = getExperimentMetricsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { experimentKey } = parsed.data;

  // Look up the experiment
  const exp = await db.query.experiment.findFirst({
    where: eq(experiment.key, experimentKey),
  });

  if (!exp) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Experiment not found'));
  }

  // Get all assignments for this experiment
  const assignments = await db.query.experimentAssignment.findMany({
    where: eq(experimentAssignment.experimentId, exp.id),
  });

  // Get all campaign configs stamped with this experiment
  const campaigns = await db.query.metaCampaignConfig.findMany({
    where: eq(metaCampaignConfig.experimentId, exp.id),
  });

  // Build cohorts
  const cohortMap = new Map<
    string,
    { orgIds: Set<string>; campaignIds: string[] }
  >();

  // Initialize cohorts from variant definitions
  for (const variantKey of Object.keys(exp.variants)) {
    cohortMap.set(variantKey, { orgIds: new Set(), campaignIds: [] });
  }

  // Count organizations per variant from assignments
  for (const assignment of assignments) {
    const cohort = cohortMap.get(assignment.variant);
    if (cohort) {
      cohort.orgIds.add(assignment.organizationId);
    }
  }

  // Count campaigns per variant
  for (const campaign of campaigns) {
    if (campaign.experimentVariant) {
      const cohort = cohortMap.get(campaign.experimentVariant);
      if (cohort) {
        cohort.campaignIds.push(campaign.metaCampaignId);
      }
    }
  }

  // Collect all meta campaign IDs across all variants to batch-query
  const allMetaCampaignIds = campaigns.map((c) => c.metaCampaignId);

  // Get ad internal IDs for these campaigns (metaAd.metaCampaignId → metaAd.id)
  // Then count conversations where metadata->>'adInternalId' matches
  const adIdsByCampaign = new Map<string, string[]>();
  if (allMetaCampaignIds.length > 0) {
    const ads = await db
      .select({ id: metaAd.id, metaCampaignId: metaAd.metaCampaignId })
      .from(metaAd)
      .where(inArray(metaAd.metaCampaignId, allMetaCampaignIds));

    for (const ad of ads) {
      if (!ad.metaCampaignId) continue;
      const existing = adIdsByCampaign.get(ad.metaCampaignId) ?? [];
      existing.push(ad.id);
      adIdsByCampaign.set(ad.metaCampaignId, existing);
    }
  }

  // For each variant, count conversations and bookings
  const variantConversationCounts = new Map<string, number>();
  const variantBookingCounts = new Map<string, number>();

  for (const [variant, data] of cohortMap) {
    // Collect all ad IDs for this variant's campaigns
    const variantAdIds: string[] = [];
    for (const campaignId of data.campaignIds) {
      const ids = adIdsByCampaign.get(campaignId);
      if (ids) variantAdIds.push(...ids);
    }

    if (variantAdIds.length === 0) {
      variantConversationCounts.set(variant, 0);
      variantBookingCounts.set(variant, 0);
      continue;
    }

    // Count conversations where metadata->>'adInternalId' matches any of these ad IDs
    const [convResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversation)
      .where(
        inArray(sql`${conversation.metadata}->>'adInternalId'`, variantAdIds)
      );
    variantConversationCounts.set(variant, convResult?.count ?? 0);

    // Count bookings: conversation.externalUserId → lead.facebookLeadId → appointment.leadId
    // Join chain: conversations with these ads → their external user IDs → leads → appointments
    const [bookingResult] = await db
      .select({ count: sql<number>`count(distinct ${appointment.id})::int` })
      .from(appointment)
      .innerJoin(lead, eq(appointment.leadId, lead.id))
      .innerJoin(
        conversation,
        eq(lead.facebookLeadId, conversation.externalUserId)
      )
      .where(
        and(
          inArray(sql`${conversation.metadata}->>'adInternalId'`, variantAdIds),
          notDeleted(appointment),
          notDeleted(lead)
        )
      );
    variantBookingCounts.set(variant, bookingResult?.count ?? 0);
  }

  const variants = exp.variants as Record<
    string,
    { label: string; weight: number }
  >;

  const cohorts: ExperimentCohort[] = Array.from(cohortMap.entries()).map(
    ([variant, data]) => {
      const conversationCount = variantConversationCounts.get(variant) ?? 0;
      const bookingCount = variantBookingCounts.get(variant) ?? 0;
      return {
        variant,
        label: variants[variant]?.label ?? variant,
        organizationCount: data.orgIds.size,
        campaignCount: data.campaignIds.length,
        metaCampaignIds: data.campaignIds,
        conversationCount,
        bookingCount,
        bookingRate:
          conversationCount > 0 ? bookingCount / conversationCount : null,
      };
    }
  );

  return ok({
    experimentId: exp.id,
    experimentKey: exp.key,
    experimentName: exp.name,
    status: exp.status,
    cohorts,
  });
};

export const getExperimentMetrics = (
  db: DbConnection,
  input: GetExperimentMetricsInput
) =>
  trackedResult(
    'experiments.getExperimentMetrics',
    () => getExperimentMetricsImpl(db, input),
    { properties: { experimentKey: input.experimentKey } }
  );

export type GetExperimentMetricsResult = Awaited<
  ReturnType<typeof getExperimentMetrics>
>;
