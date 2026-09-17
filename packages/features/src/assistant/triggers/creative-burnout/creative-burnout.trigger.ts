import {
  metaCampaignConfig,
  metaCampaignDailyInsights,
  sql,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import type { DbConnection, Result } from '../../../shared/index.js';
import type { CreateRecommendationInput } from '../../services/create-recommendation/index.js';
import { generateRecommendationPayload } from '../../services/generate-recommendation-payload/index.js';
import { type TriggerOutcome, runOrgLoop } from '../_shared.js';

/**
 * Trigger: `creative_burnout`
 * Fires daily. For each post-learning-phase campaign whose 14-day
 * frequency exceeds 3.5 (the shared-spec Tier-A tunable for ad creative
 * fatigue), writes one recommendation per org so the operator knows it's
 * time to swap in fresh creative.
 *
 * Why frequency, not CPM/CTR: frequency is the leading indicator. By the
 * time CPM rises and CTR falls, performance has already degraded. The
 * 3.5 threshold is the same one `claire-spec-v2.md` Decision 1 / Tier A
 * defaults bake in (recommendable / not auto-actioned).
 *
 * Window guards:
 *
 *   - **Learning phase exclusion** — same 10-day floor as `cpl_spike`. Per
 *     shared-spec hard blocks, never recommend creative changes during
 *     learning; restarts the algorithm and wastes the spend so far.
 *
 *   - **Frequency aggregation** — `meta_campaign_daily_insights.frequency`
 *     is a string (Meta returns "1.234567"). We average the daily values
 *     across the 14-day window per campaign rather than summing — Meta's
 *     daily frequency is already the cumulative-since-launch value at that
 *     date, so a 14-day average smooths daily noise without
 *     double-counting impressions. Threshold then applied to the
 *     average.
 *
 *   - **Per-org dedupe** — `findActiveRecommendationByKind` keeps it to one
 *     active row at a time. DISTINCT ON picks the campaign with the
 *     highest frequency for the toast.
 *
 *   - **Skips orgs without Meta connected implicitly**: no rows in
 *     `meta_campaign_daily_insights` → JOIN yields nothing.
 *
 * Per claire.md §4 C-16: writes `primary_action.type: 'navigate'` to
 * `/assistant?prefill=…` so the operator drops into a chat seeded with
 * the creative-refresh question.
 */
const FREQUENCY_THRESHOLD = 3.5; // Tier A tunable
const LEARNING_PHASE_DAYS = 10; // mirrors getCampaignLearningStatus
const MIN_DAYS_WITH_DATA = 7; // need at least a week of frequency rows

interface CreativeBurnoutRow {
  organizationId: string;
  metaCampaignId: string;
  avgFrequency: number;
  daysWithData: number;
}

const runImpl = async (db: DbConnection): Promise<Result<TriggerOutcome>> => {
  // Average the daily frequency strings (cast to float) across the last
  // 14 days, JOIN to metaCampaignConfig for the post-learning filter,
  // pick rows where the average exceeds 3.5. DISTINCT ON keeps the
  // highest-frequency campaign per org.
  const qualifying = await db.execute(sql<CreativeBurnoutRow[]>`
    WITH freq AS (
      SELECT
        ${metaCampaignDailyInsights.organizationId} AS organization_id,
        ${metaCampaignDailyInsights.metaCampaignId} AS meta_campaign_id,
        AVG(NULLIF(${metaCampaignDailyInsights.frequency}, '')::float) AS avg_frequency,
        COUNT(*) FILTER (
          WHERE ${metaCampaignDailyInsights.frequency} IS NOT NULL
            AND ${metaCampaignDailyInsights.frequency} <> ''
        )::int AS days_with_data
      FROM ${metaCampaignDailyInsights}
      WHERE ${metaCampaignDailyInsights.date} >= NOW() - INTERVAL '14 days'
        AND ${metaCampaignDailyInsights.date} < NOW()
        AND ${metaCampaignDailyInsights.metaAdId} IS NULL
      GROUP BY ${metaCampaignDailyInsights.organizationId},
               ${metaCampaignDailyInsights.metaCampaignId}
    )
    SELECT DISTINCT ON (f.organization_id)
      f.organization_id    AS "organizationId",
      f.meta_campaign_id   AS "metaCampaignId",
      f.avg_frequency      AS "avgFrequency",
      f.days_with_data     AS "daysWithData"
    FROM freq f
    JOIN ${metaCampaignConfig} c
      ON c.meta_campaign_id = f.meta_campaign_id
     AND c.organization_id  = f.organization_id
    WHERE c.created_at < NOW() - INTERVAL '${sql.raw(String(LEARNING_PHASE_DAYS))} days'
      AND f.days_with_data >= ${MIN_DAYS_WITH_DATA}
      AND f.avg_frequency > ${FREQUENCY_THRESHOLD}
    ORDER BY f.organization_id, f.avg_frequency DESC
  `);

  const rows = (qualifying as unknown as CreativeBurnoutRow[]) ?? [];

  const inputs: CreateRecommendationInput[] = [];
  for (const row of rows) {
    const avgFrequency = Number(row.avgFrequency);
    const daysWithData = Number(row.daysWithData);

    const generated = await generateRecommendationPayload(db, {
      organizationId: row.organizationId,
      kind: 'creative_burnout',
      triggerContext: {
        metaCampaignId: row.metaCampaignId,
        avgFrequency,
        daysWithData,
      },
    });
    if (!generated.success) continue;

    inputs.push({
      organizationId: row.organizationId,
      kind: 'creative_burnout',
      title: generated.data.title,
      body: generated.data.body,
      metadata: {
        metaCampaignId: row.metaCampaignId,
        avgFrequency,
        daysWithData,
        thresholdUsed: FREQUENCY_THRESHOLD,
      },
      primaryAction: {
        label: 'Open Claire',
        type: 'navigate',
        target:
          '/assistant?prefill=One of my campaigns has fatigue — what fresh creative should I run next?',
      },
    });
  }

  return runOrgLoop(db, inputs);
};

export const runCreativeBurnoutTrigger = (db: DbConnection) =>
  trackedResult('assistant.triggers.creativeBurnout', () => runImpl(db));
