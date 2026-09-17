import { z } from 'zod';

/**
 * Schema for deleting a voice script
 */
export const deleteVoiceScriptSchema = z.object({
  id: z.string().min(1, 'Voice script ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type DeleteVoiceScriptInput = z.infer<typeof deleteVoiceScriptSchema>;
