import { updateServiceRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for updating an organization service.
 *
 * DERIVED from the canonical wire contract: `updateServiceRequestBase` in
 * `packages/contracts/src/requests/catalog.ts` is the SOURCE, and this is that
 * object plus the fields the SERVER injects — `id` (the
 * `PUT /organization-services/:id` route param) and `organizationId`
 * (active-org session). Change a client-supplied field IN THE CONTRACT, not
 * here.
 */
export const updateServiceSchema = updateServiceRequestBase.extend({
  id: z.string().min(1, 'Service ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
