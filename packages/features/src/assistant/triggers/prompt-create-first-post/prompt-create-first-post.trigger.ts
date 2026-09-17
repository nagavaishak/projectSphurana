import { organization, socialPost, sql } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import type { DbConnection, Result } from '../../../shared/index.js';
import type { CreateRecommendationInput } from '../../services/create-recommendation/index.js';
import { generateRecommendationPayload } from '../../services/generate-recommendation-payload/index.js';
import { type TriggerOutcome, runOrgLoop } from '../_shared.js';

/**
 * Trigger: `prompt_create_first_post`
 * Fires daily. Finds orgs with zero social posts and writes an LLM-generated
 * recommendation inviting the owner to schedule their first post. Accept
 * dispatches the `create_post` tour.
 *
 * Per Decision 2b: the payload generator falls back to static copy on any
 * LLM failure so the trigger always ships a safe recommendation.
 *
 * Per Decision 6: `type: 'tour'`, `target: 'create_post'`.
 */
const runImpl = async (db: DbConnection): Promise<Result<TriggerOutcome>> => {
  // Orgs with zero social posts ever.
  const qualifying = await db.execute(sql<{ id: string }[]>`
    SELECT o.id
    FROM ${organization} o
    WHERE NOT EXISTS (
      SELECT 1 FROM ${socialPost} sp WHERE sp.organization_id = o.id
    )
  `);

  const rows = (qualifying as unknown as { id: string }[]) ?? [];

  const inputs: CreateRecommendationInput[] = [];
  for (const { id } of rows) {
    const generated = await generateRecommendationPayload(db, {
      organizationId: id,
      kind: 'prompt_create_first_post',
    });
    if (!generated.success) continue;

    inputs.push({
      organizationId: id,
      kind: 'prompt_create_first_post',
      title: generated.data.title,
      body: generated.data.body,
      primaryAction: {
        label: 'Accept',
        type: 'tour',
        target: 'create_post',
        payload: {
          suggestedService: generated.data.suggestedService,
        },
      },
    });
  }

  return runOrgLoop(db, inputs);
};

export const runPromptCreateFirstPostTrigger = (db: DbConnection) =>
  trackedResult('assistant.triggers.promptCreateFirstPost', () => runImpl(db), {
    properties: {},
  });
