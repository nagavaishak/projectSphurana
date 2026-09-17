import { metaCampaignConfig, sql } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import type { DbConnection, Result } from '../../../shared/index.js';
import { type TriggerOutcome, runOrgLoop } from '../_shared.js';

/**
 * Trigger: `content_learning_phase_prompt`
 * Fires daily. Finds orgs with an active campaign in its Meta learning-phase
 * window (first 10 days since campaign was created). Nudges the owner to
 * post organic content while Meta learns.
 *
 * Uses createdAt as a proxy for campaign launch — there's no explicit
 * launch/activated_at column in meta_campaign_config.
 */
const runImpl = async (db: DbConnection): Promise<Result<TriggerOutcome>> => {
  const qualifying = await db.execute(sql<{ id: string }[]>`
    SELECT DISTINCT c.organization_id AS id
    FROM ${metaCampaignConfig} c
    WHERE c.created_at > NOW() - INTERVAL '10 days'
  `);

  const rows = (qualifying as unknown as { id: string }[]) ?? [];

  return runOrgLoop(
    db,
    rows.map(({ id }) => ({
      organizationId: id,
      kind: 'content_learning_phase_prompt' as const,
      title: 'Make content while your ad is learning',
      body: 'The people your ads bring in will check your page first — keep it active.',
      primaryAction: {
        label: 'Create a post',
        type: 'navigate' as const,
        target: '/dashboard/content',
      },
    }))
  );
};

export const runContentLearningPhasePromptTrigger = (db: DbConnection) =>
  trackedResult('assistant.triggers.contentLearningPhasePrompt', () =>
    runImpl(db)
  );
