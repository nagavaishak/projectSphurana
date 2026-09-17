import { asset, socialPost, sql } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import type { DbConnection, Result } from '../../../shared/index.js';
import { type TriggerOutcome, runOrgLoop } from '../_shared.js';

/**
 * Trigger: `content_unused_assets`
 * Fires daily. Finds orgs that have uploaded assets in the last 7 days but
 * haven't published any social post in that same window — signal that
 * assets are sitting unused.
 *
 * Heuristic. A cleaner version would join assets to their actual usage in
 * posts/videos, but that requires understanding the asset-usage FK which
 * varies by content type. Keeping it simple for v2.
 */
const runImpl = async (db: DbConnection): Promise<Result<TriggerOutcome>> => {
  const qualifying = await db.execute(sql<{ id: string }[]>`
    SELECT DISTINCT a.organization_id AS id
    FROM ${asset} a
    WHERE a.created_at > NOW() - INTERVAL '7 days'
      AND NOT EXISTS (
        SELECT 1 FROM ${socialPost} p
        WHERE p.organization_id = a.organization_id
          AND p.status = 'published'
          AND p.published_at > NOW() - INTERVAL '7 days'
      )
  `);

  const rows = (qualifying as unknown as { id: string }[]) ?? [];

  return runOrgLoop(
    db,
    rows.map(({ id }) => ({
      organizationId: id,
      kind: 'content_unused_assets' as const,
      title: "You've got content that isn't in rotation",
      body: "Some of your recent uploads haven't made it into a post yet. Let's put them to work.",
      primaryAction: {
        label: 'View your content',
        type: 'navigate' as const,
        target: '/dashboard/content',
      },
    }))
  );
};

export const runContentUnusedAssetsTrigger = (db: DbConnection) =>
  trackedResult('assistant.triggers.contentUnusedAssets', () => runImpl(db));
