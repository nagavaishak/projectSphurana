import { createVoiceScriptRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for creating a new voice script.
 *
 * DERIVED from the wire contract — see `createVoiceScriptRequestBase` in
 * `packages/contracts/src/requests/content.ts`.
 */
export const createVoiceScriptSchema = createVoiceScriptRequestBase.extend({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

/**
 * Input type inferred from schema
 */
export type CreateVoiceScriptInput = z.infer<typeof createVoiceScriptSchema>;
