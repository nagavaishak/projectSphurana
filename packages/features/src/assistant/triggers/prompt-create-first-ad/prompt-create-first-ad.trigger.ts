import {
  metaCampaignConfig,
  organization,
  sql,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import type { DbConnection, Result } from '../../../shared/index.js';
import type { CreateRecommendationInput } from '../../services/create-recommendation/index.js';
import { generateRecommendationPayload } from '../../services/generate-recommendation-payload/index.js';
import { type TriggerOutcome, runOrgLoop } from '../_shared.js';

/**
 * Trigger: `prompt_create_first_ad`
 * Fires daily. Finds orgs with zero campaigns and writes an LLM-generated
 * recommendation inviting the owner to create their first ad. Accept
 * dispatches the `create_ad` tour.
 *
 * Per Decision 2b: the payload generator runs each suggestion through the
 * D2b regex validator. On any LLM failure the generator returns static
 * fallback copy so the trigger still writes a (generic) recommendation.
 *
 * Per Decision 6: `type: 'tour'`, `target: 'create_ad'`.
 */
const runImpl = async (db: DbConnection): Promise<Result<TriggerOutcome>> => {
  // Orgs with zero campaigns ever.
  const qualifying = await db.execute(sql<{ id: string }[]>`
    SELECT o.id
    FROM ${organization} o
    WHERE NOT EXISTS (
      SELECT 1 FROM ${metaCampaignConfig} c WHERE c.organization_id = o.id
    )
  `);

  const rows = (qualifying as unknown as { id: string }[]) ?? [];

  // Generate payloads sequentially so we don't spike the LLM. Fine for v2
  // cadence — this trigger runs daily and the set of qualifying orgs is
  // small (first-time clinics only, and each is de-duped after one fire).
  const inputs: CreateRecommendationInput[] = [];
  for (const { id } of rows) {
    const generated = await generateRecommendationPayload(db, {
      organizationId: id,
      kind: 'prompt_create_first_ad',
    });
    if (!generated.success) continue;

    inputs.push({
      organizationId: id,
      kind: 'prompt_create_first_ad',
      title: generated.data.title,
      body: generated.data.body,
      primaryAction: {
        label: 'Accept',
        type: 'tour',
        target: 'create_ad',
        payload: {
          suggestedCampaignName: generated.data.suggestedCampaignName,
          suggestedService: generated.data.suggestedService,
          suggestedPrice: generated.data.suggestedPrice,
          suggestedPainPoint: generated.data.suggestedPainPoint,
          campaignAngle: generated.data.campaignAngle,
        },
      },
    });
  }

  return runOrgLoop(db, inputs);
};

export const runPromptCreateFirstAdTrigger = (db: DbConnection) =>
  trackedResult('assistant.triggers.promptCreateFirstAd', () => runImpl(db));
