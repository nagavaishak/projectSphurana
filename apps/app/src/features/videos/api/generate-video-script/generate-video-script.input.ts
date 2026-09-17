import { z } from 'zod';

/**
 * The typed INTENT for generating a video script. Every generate entry point
 * (new-post-dialog, generate-video-dialog, create-video wizard script-step /
 * context, create-from-client step-configure) passes this; only
 * {@link buildGenerateVideoScriptPayload} turns it into the wire body.
 */
export const generateVideoScriptInputSchema = z.object({
  templateId: z.string(),
  variationId: z.string(),
  serviceId: z.string().optional(),
  narrationMode: z.enum(['recorded', 'ai_voiceover', 'text_only']).optional(),
  /** Optional free-text instruction to steer the generated script. */
  refinementInstruction: z.string().optional(),
  /** The previously generated script, for refinement-aware re-rolls. */
  priorScriptText: z.string().optional(),
});

export type GenerateVideoScriptInput = z.infer<
  typeof generateVideoScriptInputSchema
>;
