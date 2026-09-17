import { createVoiceScriptRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';

import type { CreateVoiceScriptInput } from './create-voice-script.input';

/**
 * The wire body for `POST /voice-scripts`, built in exactly one place.
 *
 * `.strict()` so an extra or missing top-level field is a parse error, not a
 * silent strip — this is what stops the two create surfaces (the onboarding
 * step-3 editor and the ai-assistant voice panel) from drifting apart. Every
 * surface passes the shared {@link CreateVoiceScriptInput} intent; only the
 * builder below assembles the request.
 *
 * Shape mirrors `CreateVoiceScriptDto` on the API: `organizationId` is stamped
 * from the session server-side, `name`/`isDefault`/`qualificationQuestions`/
 * `followUps` have server defaults, and `script` (the AI agent prompt) IS part
 * of the contract — it is persisted by the service and lives on the entity.
 */
export const createVoiceScriptBodySchema = createVoiceScriptRequestSchema;

export type CreateVoiceScriptBody = z.infer<typeof createVoiceScriptBodySchema>;

/**
 * Turns the create-voice-script intent into the wire body. Only fields the
 * surface actually provided are emitted, so the request stays minimal and two
 * surfaces that set disjoint aspects (content vs. voice config) never encode
 * the same field two different ways.
 */
export function buildCreateVoiceScriptPayload(
  input: CreateVoiceScriptInput
): CreateVoiceScriptBody {
  return createVoiceScriptBodySchema.parse({
    name: input.name,
    isDefault: input.isDefault,
    initialMessage: input.initialMessage,
    script: input.script,
    qualificationQuestions: input.qualificationQuestions,
    followUps: input.followUps,
    agentConfig: input.agentConfig,
  });
}
