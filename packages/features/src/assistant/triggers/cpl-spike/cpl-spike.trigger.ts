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
 * Trigger: `cpl_spike`
 * Fires daily. For each post-learning-phase campaign whose 7-day CPL is
 * +40% week-over-week vs. the prior 7 days, writes one recommendation per
 * org (de-duped via `findActiveRecommendationByKind`).
 *
 * Window guards (see brief gotchas + shared-spec hard blocks):
 *
 *   - **Learning phase exclusion** — `metaCampaignConfig.created_at` <
 *     NOW() - INTERVAL '10 days'. Mirrors `getCampaignLearningStatus`'s
 *     LEARNING_PHASE_DAYS = 10. Changing CPL during learning resets the
 *     algorithm; the recommendation itself is informational, but the
 *     operator might be tempted to act, so we don't surface it.
 *
 *   - **Lead-floor on both windows** — both windows must have ≥ 1 lead.
 *     Otherwise CPL is undefined (divide-by-zero or 0/x → spurious "spike").
 *
 *   - **Per-org dedupe (not per-campaign)** — only the worst spike per org
 *     surfaces. Sorted by relative CPL increase desc; DISTINCT ON keeps the
 *     first row per org. The chat itself can walk through every campaign
 *     once the operator opens it.
 *
 *   - **Skips orgs without Meta connected implicitly**: those orgs have
 *     no rows in `meta_campaign_daily_insights`, so the JOIN yields nothing.
 *
 * Per claire.md §4 C-16: writes `primary_action.type: 'navigate'` to
 * `/assistant?prefill=…` so opening Claire from the toast lands the
 * operator in a chat seeded with the diagnostic question. URL is inlined
 * raw (matches sibling `no_show_surge` / `offer_expiring_soon`); the
 * front-end Next.js navigation handles encoding.
 */
const CPL_SPIKE_THRESHOLD = 1.4; // +40% week-over-week
const LEARNING_PHASE_DAYS = 10; // mirrors getCampaignLearningStatus

interface CplSpikeRow {
  organizationId: string;
  metaCampaignId: string;
  thisWeekSpendCents: number;
  thisWeekLeads: number;
  priorWeekSpendCents: number;
  priorWeekLeads: number;
  // Drizzle's `sql<T>` constraint requires an index signature.
  // Cross-boundary patch by W-C14-backend (workflow lock 2026-04-25).
  [key: string]: unknown;
}

const runImpl = async (db: DbConnection): Promise<Result<TriggerOutcome>> => {
  // Aggregate campaign-level (metaAdId IS NULL) insights for the two
  // 7-day windows, JOIN to metaCampaignConfig for the post-learning
  // filter, and pick rows where this-week CPL > 1.4 × prior-week CPL.
  // DISTINCT ON keeps the worst-relative-spike campaign per org.
  const qualifying = await db.execute(sql<CplSpikeRow[]>`
    WITH this_week AS (
      SELECT
        ${metaCampaignDailyInsights.organizationId} AS organization_id,
        ${metaCampaignDailyInsights.metaCampaignId} AS meta_campaign_id,
        SUM(${metaCampaignDailyInsights.spend})::int AS spend_cents,
        SUM(${metaCampaignDailyInsights.leads})::int AS leads
      FROM ${metaCampaignDailyInsights}
      WHERE ${metaCampaignDailyInsights.date} >= NOW() - INTERVAL '7 days'
        AND ${metaCampaignDailyInsights.date} < NOW()
        AND ${metaCampaignDailyInsights.metaAdId} IS NULL
      GROUP BY ${metaCampaignDailyInsights.organizationId},
               ${metaCampaignDailyInsights.metaCampaignId}
    ),
    prior_week AS (
      SELECT
        ${metaCampaignDailyInsights.organizationId} AS organization_id,
        ${metaCampaignDailyInsights.metaCampaignId} AS meta_campaign_id,
        SUM(${metaCampaignDailyInsights.spend})::int AS spend_cents,
        SUM(${metaCampaignDailyInsights.leads})::int AS leads
      FROM ${metaCampaignDailyInsights}
      WHERE ${metaCampaignDailyInsights.date} >= NOW() - INTERVAL '14 days'
        AND ${metaCampaignDailyInsights.date} < NOW() - INTERVAL '7 days'
        AND ${metaCampaignDailyInsights.metaAdId} IS NULL
      GROUP BY ${metaCampaignDailyInsights.organizationId},
               ${metaCampaignDailyInsights.metaCampaignId}
    )
    SELECT DISTINCT ON (t.organization_id)
      t.organization_id           AS "organizationId",
      t.meta_campaign_id          AS "metaCampaignId",
      t.spend_cents               AS "thisWeekSpendCents",
      t.leads                     AS "thisWeekLeads",
      p.spend_cents               AS "priorWeekSpendCents",
      p.leads                     AS "priorWeekLeads"
    FROM this_week t
    JOIN prior_week p
      ON p.organization_id = t.organization_id
     AND p.meta_campaign_id = t.meta_campaign_id
    JOIN ${metaCampaignConfig} c
      ON c.meta_campaign_id = t.meta_campaign_id
     AND c.organization_id  = t.organization_id
    WHERE c.created_at < NOW() - INTERVAL '${sql.raw(String(LEARNING_PHASE_DAYS))} days'
      AND t.leads > 0
      AND p.leads > 0
      AND (t.spend_cents::float / t.leads)
        > (p.spend_cents::float / p.leads) * ${CPL_SPIKE_THRESHOLD}
    ORDER BY t.organization_id,
      ((t.spend_cents::float / t.leads) /
       NULLIF((p.spend_cents::float / p.leads), 0)) DESC
  `);

  const rows = (qualifying as unknown as CplSpikeRow[]) ?? [];

  // One LLM call per qualifying org. Sequential to avoid spiking OpenAI;
  // mirrors the cadence in `prompt-create-first-ad.trigger.ts`.
  const inputs: CreateRecommendationInput[] = [];
  for (const row of rows) {
    const thisWeekSpendCents = Number(row.thisWeekSpendCents);
    const thisWeekLeads = Number(row.thisWeekLeads);
    const priorWeekSpendCents = Number(row.priorWeekSpendCents);
    const priorWeekLeads = Number(row.priorWeekLeads);

    const generated = await generateRecommendationPayload(db, {
      organizationId: row.organizationId,
      kind: 'cpl_spike',
      triggerContext: {
        metaCampaignId: row.metaCampaignId,
        thisWeekCplCents:
          thisWeekLeads > 0
            ? Math.round(thisWeekSpendCents / thisWeekLeads)
            : null,
        priorWeekCplCents:
          priorWeekLeads > 0
            ? Math.round(priorWeekSpendCents / priorWeekLeads)
            : null,
      },
    });
    if (!generated.success) continue;

    inputs.push({
      organizationId: row.organizationId,
      kind: 'cpl_spike',
      title: generated.data.title,
      body: generated.data.body,
      metadata: {
        metaCampaignId: row.metaCampaignId,
        thisWeekSpendCents,
        thisWeekLeads,
        priorWeekSpendCents,
        priorWeekLeads,
      },
      primaryAction: {
        label: 'Open Claire',
        type: 'navigate',
        target:
          '/assistant?prefill=My cost per lead has jumped this week. Can you walk me through what changed and what I should do about it?',
      },
    });
  }

  return runOrgLoop(db, inputs);
};

export const runCplSpikeTrigger = (db: DbConnection) =>
  trackedResult('assistant.triggers.cplSpike', () => runImpl(db));
