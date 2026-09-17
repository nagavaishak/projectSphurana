import { createCategoryRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * DERIVED from the canonical wire contract: `createCategoryRequestBase` in
 * `packages/contracts/src/requests/catalog.ts` is the SOURCE, and this is that
 * object plus the server-injected `organizationId` (active-org session).
 * Change a client-supplied field IN THE CONTRACT, not here.
 */
export const createCategorySchema = createCategoryRequestBase.extend({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
