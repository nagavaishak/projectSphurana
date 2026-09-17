import { metaCampaignConfig, sql } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import type { DbConnection, Result } from '../../../shared/index.js';
import { type TriggerOutcome, runOrgLoop } from '../_shared.js';

/**
 * Trigger: `learning_phase_reassurance`
 * Fires daily. Finds orgs with a campaign in day 1-10 of its Meta learning
 * phase. Informational toast (`type: 'none'`) that tells the owner to leave
 * the ad alone and make content in the meantime.
 *
 * Uses createdAt as proxy for launch (no explicit launch column).
 */
const runImpl = async (db: DbConnection): Promise<Result<TriggerOutcome>> => {
  const qualifying = await db.execute(sql<{ id: string }[]>`
    SELECT DISTINCT c.organization_id AS id
    FROM ${metaCampaignConfig} c
    WHERE c.created_at > NOW() - INTERVAL '10 days'
      AND c.created_at < NOW() - INTERVAL '1 day'
  `);

  const rows = (qualifying as unknown as { id: string }[]) ?? [];

  return runOrgLoop(
    db,
    rows.map(({ id }) => ({
      organizationId: id,
      kind: 'learning_phase_reassurance' as const,
      title: 'Your ad is learning',
      body: 'Leave it alone for now — Meta is figuring out who to show it to. Make content while you wait.',
      primaryAction: {
        label: 'Got it',
        type: 'none' as const,
      },
    }))
  );
};

export const runLearningPhaseReassuranceTrigger = (db: DbConnection) =>
  trackedResult('assistant.triggers.learningPhaseReassurance', () =>
    runImpl(db)
  );
