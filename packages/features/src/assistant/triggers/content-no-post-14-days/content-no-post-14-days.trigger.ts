import { organization, socialPost, sql } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import type { DbConnection, Result } from '../../../shared/index.js';
import { type TriggerOutcome, runOrgLoop } from '../_shared.js';

/**
 * Trigger: `content_no_post_14_days`
 * Fires daily. Finds orgs whose most recent published social post is >14 days
 * ago (or who have never published). Writes a recommendation nudging the
 * owner to post organic content.
 *
 * See claire-owner-spec.md §6 and claire-spec-v2.md Decision 7.
 */
const runImpl = async (db: DbConnection): Promise<Result<TriggerOutcome>> => {
  // Orgs with no published post within the last 14 days (or none ever).
  const qualifying = await db.execute(sql<{ id: string }[]>`
    SELECT o.id
    FROM ${organization} o
    WHERE NOT EXISTS (
      SELECT 1 FROM ${socialPost} p
      WHERE p.organization_id = o.id
        AND p.status = 'published'
        AND p.published_at > NOW() - INTERVAL '14 days'
    )
  `);

  const rows = (qualifying as unknown as { id: string }[]) ?? [];

  return runOrgLoop(
    db,
    rows.map(({ id }) => ({
      organizationId: id,
      kind: 'content_no_post_14_days' as const,
      title: "It's been a while since you posted",
      body: 'A quick post this week keeps your page warm for the leads your ads bring in.',
      primaryAction: {
        label: 'Create a post',
        type: 'navigate' as const,
        target: '/dashboard/content',
      },
    }))
  );
};

export const runContentNoPost14DaysTrigger = (db: DbConnection) =>
  trackedResult('assistant.triggers.contentNoPost14Days', () => runImpl(db));
