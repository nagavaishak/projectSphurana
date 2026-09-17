import { updateLocationRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for updating an organization location.
 *
 * DERIVED from the canonical wire contract (`updateLocationRequestBase` in
 * `@borradh-workspace/contracts`) by extending the server-injected context
 * fields onto it: `id` is the route param, `organizationId` comes from the
 * session.
 */
export const updateLocationSchema = updateLocationRequestBase.extend({
  id: z.string().min(1, 'Location ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
