import { updateVoiceScriptRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';

import type { UpdateVoiceScriptInput } from './update-voice-script.input';

/**
 * The wire body for `PUT /voice-scripts/:id` — the canonical contract from
 * `@borradh-workspace/contracts`, re-exported under its historical name.
 *
 * `.strict()` so an extra or misspelled top-level field is a parse error, not a
 * silent strip — this is what stops the three update surfaces (onboarding
 * step-3 editor, ai-assistant directive card, ai-assistant voice panel) from
 * drifting apart. `id` is a route param; every other field is an optional
 * partial edit. `script` IS part of the contract (persisted by the service,
 * present on the entity) and may be `null` to clear it.
 */
export const updateVoiceScriptBodySchema = updateVoiceScriptRequestSchema;

export type UpdateVoiceScriptBody = z.infer<typeof updateVoiceScriptBodySchema>;

/**
 * Turns the update-voice-script intent into the wire body. Only fields the
 * surface actually provided are emitted, so the PUT stays a true partial update
 * and two surfaces editing disjoint aspects never encode a shared field two
 * different ways.
 */
export function buildUpdateVoiceScriptPayload(
  input: UpdateVoiceScriptInput
): UpdateVoiceScriptBody {
  return updateVoiceScriptBodySchema.parse({
    name: input.name,
    isDefault: input.isDefault,
    initialMessage: input.initialMessage,
    script: input.script,
    qualificationQuestions: input.qualificationQuestions,
    followUps: input.followUps,
    agentConfig: input.agentConfig,
  });
}
