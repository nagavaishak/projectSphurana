import { updateVoiceScriptRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for updating a voice script.
 *
 * DERIVED from the canonical wire contract (`updateVoiceScriptRequestBase` in
 * `@borradh-workspace/contracts`) by extending the server-injected context
 * fields onto it. Field rules live in the contract; do not restate them here.
 */
export const updateVoiceScriptSchema = updateVoiceScriptRequestBase.extend({
  id: z.string().min(1, 'Voice script ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type UpdateVoiceScriptInput = z.infer<typeof updateVoiceScriptSchema>;
