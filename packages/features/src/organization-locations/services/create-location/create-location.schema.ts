import { createLocationRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for creating an organization location.
 *
 * DERIVED from the canonical wire contract (`createLocationRequestBase` in
 * `@borradh-workspace/contracts`) by extending the server-injected
 * `organizationId` onto it. Field rules (lengths, the country enum, the
 * `isPrimary` default) live in the contract; do not restate them here.
 */
export const createLocationSchema = createLocationRequestBase.extend({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type CreateLocationInput = z.infer<typeof createLocationSchema>;
