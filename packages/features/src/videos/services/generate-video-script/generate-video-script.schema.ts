import { generateVideoScriptRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * DERIVED from the wire contract — see `generateVideoScriptRequestBase` in
 * `packages/contracts/src/requests/content.ts`.
 */
export const generateVideoScriptSchema = generateVideoScriptRequestBase.extend({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GenerateVideoScriptInput = z.infer<
  typeof generateVideoScriptSchema
>;
