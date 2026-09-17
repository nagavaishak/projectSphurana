import { z } from 'zod';

import { voiceAgentConfigSchema } from '../create-voice-script/create-voice-script.input';

/**
 * The typed INTENT for updating a voice script — a partial edit. Each of the
 * three update surfaces edits a disjoint slice of the same resource:
 *  - onboarding step-3 editor: content (name, initialMessage, script,
 *    qualificationQuestions, followUps),
 *  - ai-assistant directive card: `script` (kept in sync with the chatbot
 *    directive; may be cleared to `null`),
 *  - ai-assistant voice panel: `agentConfig` (voice + language).
 *
 * All pass this intent; only {@link buildUpdateVoiceScriptPayload} assembles the
 * wire body, so a field two surfaces both touch can only be encoded one way.
 */
export const updateVoiceScriptInputSchema = z.object({
  name: z.string().optional(),
  isDefault: z.boolean().optional(),
  initialMessage: z.string().optional(),
  script: z.string().nullable().optional(),
  qualificationQuestions: z.array(z.string()).optional(),
  followUps: z.array(z.string()).optional(),
  agentConfig: voiceAgentConfigSchema.nullable().optional(),
});

export type UpdateVoiceScriptInput = z.infer<
  typeof updateVoiceScriptInputSchema
>;
