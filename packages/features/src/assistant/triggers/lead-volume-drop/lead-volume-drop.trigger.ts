import { lead, sql } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import type { DbConnection, Result } from '../../../shared/index.js';
import type { CreateRecommendationInput } from '../../services/create-recommendation/index.js';
import { generateRecommendationPayload } from '../../services/generate-recommendation-payload/index.js';
import { type TriggerOutcome, runOrgLoop } from '../_shared.js';

/**
 * Trigger: `lead_volume_drop`
 * Fires daily. For each org whose this-week lead count is more than 25%
 * below last week's, writes one recommendation so the operator can
 * diagnose what slowed.
 *
 * Window guards (per brief gotchas):
 *
 *   - **Min-volume floor of 5/week (prior week)** — low-volume orgs (e.g.
 *     2 leads → 0 leads = "100% drop") are noisy. The floor sits on the
 *     prior week so a real drop from 6 → 4 still trips, but a 2 → 0
 *     fluctuation does not.
 *
 *   - **Lead source agnostic** — counts EVERY lead, regardless of source
 *     (`facebook_lead_form`, `manual`, `voice_call_inbound`, etc.). The
 *     toast lands the operator in Claire, who can drill into "where did
 *     the drop come from" via existing skills.
 *
 *   - **Per-org dedupe** — `findActiveRecommendationByKind` keeps it to
 *     one active row at a time per org.
 *
 *   - **Unlike `cpl_spike` / `creative_burnout`, no learning-phase
 *     exclusion** — a lead-volume drop is a top-of-funnel signal that
 *     applies regardless of what's happening at the campaign level. New
 *     campaigns mid-learning don't change the calculus: if leads are
 *     down org-wide, the operator deserves the heads-up.
 *
 * Per claire.md §4 C-16: writes `primary_action.type: 'navigate'` to
 * `/assistant?prefill=…` so the operator drops into a chat seeded with
 * the volume-diagnosis question.
 */
const DROP_THRESHOLD = 0.25; // -25% week-over-week
const MIN_PRIOR_WEEK_LEADS = 5;

interface LeadVolumeDropRow {
  organizationId: string;
  thisWeekTotal: number;
  priorWeekTotal: number;
}

const runImpl = async (db: DbConnection): Promise<Result<TriggerOutcome>> => {
  // One pass over the last 14 days, grouped per org. SQL bucketing keeps
  // this O(orgs) rather than O(orgs * lead-rows).
  const rows = await db.execute(sql<LeadVolumeDropRow[]>`
    SELECT
      ${lead.organizationId} AS "organizationId",
      COUNT(*) FILTER (
        WHERE ${lead.createdAt} >= NOW() - INTERVAL '7 days'
      )::int AS "thisWeekTotal",
      COUNT(*) FILTER (
        WHERE ${lead.createdAt} >= NOW() - INTERVAL '14 days'
          AND ${lead.createdAt} < NOW() - INTERVAL '7 days'
      )::int AS "priorWeekTotal"
    FROM ${lead}
    WHERE ${lead.createdAt} >= NOW() - INTERVAL '14 days'
      AND ${lead.createdAt} < NOW()
    GROUP BY ${lead.organizationId}
  `);

  const orgRows = (rows as unknown as LeadVolumeDropRow[]) ?? [];

  const inputs: CreateRecommendationInput[] = [];
  for (const row of orgRows) {
    const thisWeekTotal = Number(row.thisWeekTotal);
    const priorWeekTotal = Number(row.priorWeekTotal);

    if (priorWeekTotal < MIN_PRIOR_WEEK_LEADS) continue;

    const drop = (priorWeekTotal - thisWeekTotal) / priorWeekTotal;
    if (drop <= DROP_THRESHOLD) continue;

    const generated = await generateRecommendationPayload(db, {
      organizationId: row.organizationId,
      kind: 'lead_volume_drop',
      triggerContext: {
        thisWeekTotal,
        priorWeekTotal,
      },
    });
    if (!generated.success) continue;

    inputs.push({
      organizationId: row.organizationId,
      kind: 'lead_volume_drop',
      title: generated.data.title,
      body: generated.data.body,
      metadata: {
        thisWeekTotal,
        priorWeekTotal,
        thresholdUsed: DROP_THRESHOLD,
      },
      primaryAction: {
        label: 'Open Claire',
        type: 'navigate',
        target:
          '/assistant?prefill=Lead volume is down this week vs last. Help me figure out what slowed and what to do.',
      },
    });
  }

  return runOrgLoop(db, inputs);
};

export const runLeadVolumeDropTrigger = (db: DbConnection) =>
  trackedResult('assistant.triggers.leadVolumeDrop', () => runImpl(db));
