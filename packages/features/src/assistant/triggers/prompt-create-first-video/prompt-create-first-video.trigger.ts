import { organization, sql, video } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import type { DbConnection, Result } from '../../../shared/index.js';
import type { CreateRecommendationInput } from '../../services/create-recommendation/index.js';
import { generateRecommendationPayload } from '../../services/generate-recommendation-payload/index.js';
import { type TriggerOutcome, runOrgLoop } from '../_shared.js';

/**
 * Trigger: `prompt_record_first_video`
 * Fires daily. Finds orgs with zero videos and writes an LLM-generated
 * recommendation inviting the owner to create their first video. Accept
 * dispatches the `create_video` tour.
 *
 * Per Decision 2b: the payload generator falls back to static copy on any
 * LLM failure so the trigger always ships a safe recommendation.
 *
 * Per Decision 6: `type: 'tour'`, `target: 'create_video'`.
 */
const runImpl = async (db: DbConnection): Promise<Result<TriggerOutcome>> => {
  // Orgs with zero videos ever.
  const qualifying = await db.execute(sql<{ id: string }[]>`
    SELECT o.id
    FROM ${organization} o
    WHERE NOT EXISTS (
      SELECT 1 FROM ${video} v WHERE v.organization_id = o.id
    )
  `);

  const rows = (qualifying as unknown as { id: string }[]) ?? [];

  const inputs: CreateRecommendationInput[] = [];
  for (const { id } of rows) {
    const generated = await generateRecommendationPayload(db, {
      organizationId: id,
      kind: 'prompt_record_first_video',
    });
    if (!generated.success) continue;

    inputs.push({
      organizationId: id,
      kind: 'prompt_record_first_video',
      title: generated.data.title,
      body: generated.data.body,
      primaryAction: {
        label: 'Accept',
        type: 'tour',
        target: 'create_video',
        payload: {
          suggestedService: generated.data.suggestedService,
          suggestedPrice: generated.data.suggestedPrice,
        },
      },
    });
  }

  return runOrgLoop(db, inputs);
};

export const runPromptRecordFirstVideoTrigger = (db: DbConnection) =>
  trackedResult(
    'assistant.triggers.promptRecordFirstVideo',
    () => runImpl(db),
    { properties: {} }
  );
