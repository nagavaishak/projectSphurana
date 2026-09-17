import { generateContentRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * DERIVED from the wire contract — see `packages/contracts/src/requests/
 * content.ts`.
 */
export const generateContentSchema = generateContentRequestBase.extend({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GenerateContentInput = z.infer<typeof generateContentSchema>;
