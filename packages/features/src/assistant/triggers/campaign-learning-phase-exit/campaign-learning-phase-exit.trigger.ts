import { metaCampaignConfig, sql } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import type { DbConnection, Result } from '../../../shared/index.js';
import { type TriggerOutcome, runOrgLoop } from '../_shared.js';

/**
 * Trigger: `campaign_learning_phase_exit`
 * Fires daily. Finds campaigns that are roughly on day 10 of their lifecycle
 * (between 10 and 11 days since creation) — the moment Meta's learning phase
 * typically exits. Invites the owner to open Claire and review performance.
 *
 * Informational (`type: 'none'`) — the toast's inline "Ask a question..."
 * input is the real affordance here. The owner can type "how's it doing?"
 * to open the panel and have Claire walk the numbers through the ladder.
 *
 * See claire-spec-v2.md Decision 4 (escalation ladder is conversational).
 */
const runImpl = async (db: DbConnection): Promise<Result<TriggerOutcome>> => {
  const qualifying = await db.execute(sql<{ id: string }[]>`
    SELECT DISTINCT c.organization_id AS id
    FROM ${metaCampaignConfig} c
    WHERE c.created_at < NOW() - INTERVAL '10 days'
      AND c.created_at > NOW() - INTERVAL '11 days'
  `);

  const rows = (qualifying as unknown as { id: string }[]) ?? [];

  return runOrgLoop(
    db,
    rows.map(({ id }) => ({
      organizationId: id,
      kind: 'campaign_learning_phase_exit' as const,
      title: 'Your ad has finished learning',
      body: "Let's take a look at how it's going — ask me anything below.",
      primaryAction: {
        label: 'Got it',
        type: 'none' as const,
      },
    }))
  );
};

export const runCampaignLearningPhaseExitTrigger = (db: DbConnection) =>
  trackedResult('assistant.triggers.campaignLearningPhaseExit', () =>
    runImpl(db)
  );
