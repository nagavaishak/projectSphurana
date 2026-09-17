import { updateCategoryRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * DERIVED from the canonical wire contract: `updateCategoryRequestBase` in
 * `packages/contracts/src/requests/catalog.ts` is the SOURCE, and this is that
 * object plus the fields the SERVER injects — `id` (the
 * `PUT /service-categories/:id` route param) and `organizationId` (active-org
 * session). Change a client-supplied field IN THE CONTRACT, not here.
 */
export const updateCategorySchema = updateCategoryRequestBase.extend({
  id: z.string().min(1, 'Category ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
