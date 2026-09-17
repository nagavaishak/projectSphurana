import { updatePractitionerRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for updating a practitioner.
 *
 * DERIVED from the canonical wire contract (`updatePractitionerRequestBase` in
 * `@borradh-workspace/contracts`) by extending the server-injected context
 * fields onto it: `id` comes from the route param and `organizationId` from the
 * active-org session, so neither is part of the body. Field rules live in the
 * contract; do not restate them here.
 */
export const updatePractitionerSchema = updatePractitionerRequestBase.extend({
  id: z.string().min(1, 'Practitioner ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type UpdatePractitionerInput = z.infer<typeof updatePractitionerSchema>;
