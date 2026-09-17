import { z } from 'zod';

/**
 * Voice agent configuration the UI can set (voice, language, call limits).
 * `.passthrough()` so callers can carry forward extra keys already stored on
 * the script's `agentConfig` without this schema dropping them.
 */
export const voiceAgentConfigSchema = z
  .object({
    voice: z.string().optional(),
    language: z.string().optional(),
    maxCallDuration: z.number().optional(),
    endCallAfterSilence: z.number().optional(),
  })
  .passthrough();

/**
 * The typed INTENT for creating a voice script — the shape the UI naturally
 * holds. Every create surface (onboarding step-3 editor, ai-assistant voice
 * panel) passes this; only {@link buildCreateVoiceScriptPayload} turns it into
 * the wire body. `initialMessage` is the one field the API requires on create.
 */
export const createVoiceScriptInputSchema = z.object({
  name: z.string().optional(),
  isDefault: z.boolean().optional(),
  initialMessage: z.string(),
  script: z.string().optional(),
  qualificationQuestions: z.array(z.string()).optional(),
  followUps: z.array(z.string()).optional(),
  agentConfig: voiceAgentConfigSchema.optional(),
});

export type CreateVoiceScriptInput = z.infer<
  typeof createVoiceScriptInputSchema
>;
