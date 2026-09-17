import { sql } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  SPEND_THRESHOLD_USD_CENTS,
  advanceTroubleshootState,
  getHighIntentConversationStats,
} from '../../../meta-campaigns/troubleshoot/index.js';
import type { DbConnection, Result } from '../../../shared/index.js';
import type { CreateRecommendationInput } from '../../services/create-recommendation/index.js';
import { type TriggerOutcome, runOrgLoop } from '../_shared.js';

/**
 * Trigger: `campaign_no_leads_4d` (PRD-1 Task 5).
 *
 * Proactive sibling of the reactive troubleshoot skill. For each active
 * campaign that has spent past the €80 gate yet produced ZERO high-intent
 * leads over the last 4 days, writes one recommendation per org and stamps the
 * campaign's troubleshoot state (`mark_diagnosed`). Reuses the SAME
 * high-intent predicate the `diagnoseCampaign` service uses
 * (`getHighIntentConversationStats`) — one source of truth, not two.
 *
 * Window guards:
 *   - **€80 spend gate** — cumulative USD-normalized spend over 30 days must
 *     clear `SPEND_THRESHOLD_USD_CENTS`. Mirrors the framework's "don't judge
 *     a campaign before €80" rule and suppresses brand-new campaigns.
 *   - **Still delivering** — at least one campaign-level insight row in the
 *     last 4 days, so paused/finished campaigns don't fire.
 *   - **Per-org dedupe** — one recommendation per org (the highest-spend
 *     qualifying campaign), de-duped against active rows via `runOrgLoop`.
 *   - **Orgs without Meta connected** are implicitly skipped (no insight rows).
 */
const LOOKBACK_DAYS = 4;
const SPEND_WINDOW_DAYS = 30;

interface CandidateRow {
  organizationId: string;
  metaCampaignId: string;
  spendUsdCents: number | string;
  [key: string]: unknown;
}

const runImpl = async (db: DbConnection): Promise<Result<TriggerOutcome>> => {
  // Campaigns past the €80 gate that are still delivering (have a row in the
  // last 4 days). Ordered so the highest-spend campaign per org comes first.
  const candidates = await db.execute(sql<CandidateRow[]>`
    SELECT
      ${sql.raw('organization_id')}  AS "organizationId",
      ${sql.raw('meta_campaign_id')} AS "metaCampaignId",
      SUM(${sql.raw('spend_usd')})::int AS "spendUsdCents"
    FROM ${sql.raw('meta_campaign_daily_insights')}
    WHERE ${sql.raw('meta_ad_id')} IS NULL
      AND ${sql.raw('date')} >= NOW() - INTERVAL '${sql.raw(String(SPEND_WINDOW_DAYS))} days'
    GROUP BY ${sql.raw('organization_id')}, ${sql.raw('meta_campaign_id')}
    HAVING SUM(${sql.raw('spend_usd')}) >= ${SPEND_THRESHOLD_USD_CENTS}
       AND COUNT(*) FILTER (
             WHERE ${sql.raw('date')} >= NOW() - INTERVAL '${sql.raw(String(LOOKBACK_DAYS))} days'
           ) > 0
    ORDER BY "organizationId", "spendUsdCents" DESC
  `);

  const rows = (candidates as unknown as CandidateRow[]) ?? [];

  const inputs: CreateRecommendationInput[] = [];
  const orgsHandled = new Set<string>();

  for (const row of rows) {
    // One recommendation per org — keep the highest-spend qualifier.
    if (orgsHandled.has(row.organizationId)) continue;

    const stats = await getHighIntentConversationStats(db, {
      organizationId: row.organizationId,
      metaCampaignId: row.metaCampaignId,
      withinDays: LOOKBACK_DAYS,
    });

    // Zero high-intent leads in the window → this campaign has gone quiet.
    if (stats.highIntentCount > 0) continue;

    orgsHandled.add(row.organizationId);

    // Record the diagnosis on the troubleshoot state so the reactive skill and
    // an escalation hand-off can see when we last flagged it. Non-fatal.
    await advanceTroubleshootState(db, {
      organizationId: row.organizationId,
      metaCampaignId: row.metaCampaignId,
      action: 'mark_diagnosed',
    });

    inputs.push({
      organizationId: row.organizationId,
      kind: 'campaign_no_leads_4d',
      title: 'A campaign has gone quiet',
      body: "One of your campaigns has spent over €80 but hasn't produced a high-intent lead in four days. Open me and we'll work out what to change.",
      metadata: {
        metaCampaignId: row.metaCampaignId,
        spendUsdCents: Number(row.spendUsdCents),
        lookbackDays: LOOKBACK_DAYS,
      },
      primaryAction: {
        label: 'Open Claire',
        type: 'navigate',
        target:
          '/assistant?prefill=One of my campaigns has spent a fair bit but I am not getting bookings. Can you diagnose it and tell me what to change?',
      },
    });
  }

  return runOrgLoop(db, inputs);
};

export const runFourDayNoLeadsTrigger = (db: DbConnection) =>
  trackedResult('assistant.triggers.fourDayNoLeads', () => runImpl(db));
