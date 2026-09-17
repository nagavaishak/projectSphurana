import { appointment, sql } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import type { DbConnection, Result } from '../../../shared/index.js';
import type { CreateRecommendationInput } from '../../services/create-recommendation/index.js';
import { generateRecommendationPayload } from '../../services/generate-recommendation-payload/index.js';
import { type TriggerOutcome, runOrgLoop } from '../_shared.js';

/**
 * Trigger: `no_show_surge`
 * Fires daily. Compares this week's no-show rate to last week's per org. If
 * the rate is up by more than 15% week-over-week AND last week had at least
 * 10 appointments (so we don't fire on low-volume orgs where one no-show
 * looks like a 50% spike), surface a recommendation.
 *
 * Per-(org, kind) dedup is enough — only one active no_show_surge rec at a
 * time per org. Once the operator dismisses it, the next daily run is free
 * to re-trigger (the surge is meant to be fresh information, not a static
 * weekly digest).
 *
 * `primary_action.type: 'navigate'` to `/assistant?prefill=…` so the
 * operator lands in a chat seeded with the relevant question rather than
 * an appointments page they'd have to interpret on their own.
 */
const MIN_PRIOR_WEEK_APPOINTMENTS = 10;
const SURGE_THRESHOLD = 0.15; // +15% week-over-week

interface OrgWeekRow {
  organizationId: string;
  thisWeekTotal: number;
  thisWeekNoShows: number;
  lastWeekTotal: number;
  lastWeekNoShows: number;
}

const runImpl = async (db: DbConnection): Promise<Result<TriggerOutcome>> => {
  // One pass over the last 14 days, grouped per org. We let SQL do the
  // bucketing so a 1000-org tenant doesn't fan out into 1000 round-trips.
  const rows = await db.execute(sql<OrgWeekRow[]>`
    SELECT
      a.organization_id AS "organizationId",
      COUNT(*) FILTER (WHERE a.start_date >= NOW() - INTERVAL '7 days')
        AS "thisWeekTotal",
      COUNT(*) FILTER (
        WHERE a.start_date >= NOW() - INTERVAL '7 days'
          AND a.status = 'no_show'
      ) AS "thisWeekNoShows",
      COUNT(*) FILTER (
        WHERE a.start_date >= NOW() - INTERVAL '14 days'
          AND a.start_date < NOW() - INTERVAL '7 days'
      ) AS "lastWeekTotal",
      COUNT(*) FILTER (
        WHERE a.start_date >= NOW() - INTERVAL '14 days'
          AND a.start_date < NOW() - INTERVAL '7 days'
          AND a.status = 'no_show'
      ) AS "lastWeekNoShows"
    FROM ${appointment} a
    WHERE a.start_date >= NOW() - INTERVAL '14 days'
      AND a.start_date < NOW()
    GROUP BY a.organization_id
  `);

  const weekRows = (rows as unknown as OrgWeekRow[]) ?? [];

  const inputs: CreateRecommendationInput[] = [];
  for (const row of weekRows) {
    // Postgres COUNT comes back as bigint → string in some drivers, number
    // in others. Coerce defensively.
    const lastWeekTotal = Number(row.lastWeekTotal);
    const thisWeekTotal = Number(row.thisWeekTotal);
    const lastWeekNoShows = Number(row.lastWeekNoShows);
    const thisWeekNoShows = Number(row.thisWeekNoShows);

    if (lastWeekTotal < MIN_PRIOR_WEEK_APPOINTMENTS) continue;
    if (thisWeekTotal === 0) continue;

    const lastWeekRate = lastWeekNoShows / lastWeekTotal;
    const thisWeekRate = thisWeekNoShows / thisWeekTotal;

    // Surge = rate this week is more than (1 + SURGE_THRESHOLD) × last week.
    // Special case: when last week had zero no-shows, any no-shows this week
    // qualify as a surge so long as the volume floor is met.
    const surged =
      lastWeekRate === 0
        ? thisWeekNoShows > 0
        : thisWeekRate > lastWeekRate * (1 + SURGE_THRESHOLD);

    if (!surged) continue;

    const generated = await generateRecommendationPayload(db, {
      organizationId: row.organizationId,
      kind: 'no_show_surge',
    });
    if (!generated.success) continue;

    inputs.push({
      organizationId: row.organizationId,
      kind: 'no_show_surge',
      title: generated.data.title,
      body: generated.data.body,
      metadata: {
        thisWeekNoShows,
        thisWeekTotal,
        lastWeekNoShows,
        lastWeekTotal,
      },
      primaryAction: {
        label: 'Open Claire',
        type: 'navigate',
        target:
          '/assistant?prefill=Show me my recent no-shows and what we can do about it',
      },
    });
  }

  return runOrgLoop(db, inputs);
};

export const runNoShowSurgeTrigger = (db: DbConnection) =>
  trackedResult('assistant.triggers.noShowSurge', () => runImpl(db));
